/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {OnDestroy} from '../metadata/lifecycle_hooks';
import {Type} from '../type';
import {stringify} from '../util';

import {InjectableDef, InjectableType, InjectorDef, InjectorType, InjectorTypeWithProviders} from './defs';
import {resolveForwardRef} from './forward_ref';
import {InjectableDefToken, InjectionToken} from './injection_token';
import {INJECTOR, InjectFlags, Injector, NullInjector, THROW_IF_NOT_FOUND, USE_VALUE, inject, injectArgs, setCurrentInjector} from './injector';
import {ClassProvider, ConstructorProvider, ExistingProvider, FactoryProvider, Provider, StaticClassProvider, TypeProvider, ValueProvider} from './provider';
import {APP_ROOT} from './scope';



/**
 * Internal type for a single provider in a deep provider array.
 */
type SingleProvider = TypeProvider | ValueProvider | ClassProvider | ConstructorProvider |
    ExistingProvider | FactoryProvider | StaticClassProvider;

/**
 * Marker which indicates that a value has not yet been created from the factory function.
 */
const NOT_YET = {};

/**
 * Marker which indicates that the factory function for a token is in the process of being called.
 *
 * If the injector is asked to inject a token with its value set to CIRCULAR, that indicates
 * injection of a dependency has recursively attempted to inject the original token, and there is
 * a circular dependency among the providers.
 */
const CIRCULAR = {};

const EMPTY_ARRAY = [] as any[];

/**
 * A lazily initialized NullInjector.
 */
let NULL_INJECTOR: Injector|undefined = undefined;

function getNullInjector(): Injector {
  if (NULL_INJECTOR === undefined) {
    NULL_INJECTOR = new NullInjector();
  }
  return NULL_INJECTOR;
}

/**
 * An entry in the injector which tracks information about the given token, including a possible
 * current value.
 */
interface Record<T> {
  factory: (() => T)|undefined;
  value: T|{};
  multi: any[]|undefined;
}

/**
 * Create a new `Injector` which is configured using `InjectorDefType`s.
 *
 * @experimental
 */
export function createInjector(
    defType: /* InjectorDefType<any> */ any, parent: Injector | null = null): Injector {
  parent = parent || getNullInjector();
  return new R3Injector(defType, parent);
}

export class R3Injector {
  /**
   * Map of tokens to records which contain the instances of those tokens.
   */
  private records = new Map<Type<any>|InjectionToken<any>, Record<any>>();

  /**
   * The transitive set of `InjectorDefType`s which define this injector.
   */
  private injectorDefTypes = new Set<InjectorType<any>>();

  /**
   * Set of values instantiated by this injector which contain `ngOnDestroy` lifecycle hooks.
   */
  private onDestroy = new Set<OnDestroy>();

  /**
   * Flag indicating this injector provides the APP_ROOT_SCOPE token, and thus counts as the
   * root scope.
   */
  private readonly isRootInjector: boolean;

  /**
   * Flag indicating that this injector was previously destroyed.
   */
  private destroyed = false;

  constructor(def: InjectorType<any>, readonly parent: Injector) {
    // Start off by creating Records for every provider declared in every InjectorDefType
    // included transitively in `def`.
    deepForEach(
        [def], injectorDef => this.processInjectorType(injectorDef, new Set<InjectorType<any>>()));

    // Make sure the INJECTOR token provides this injector.
    this.records.set(INJECTOR, makeRecord(undefined, this));

    // Detect whether this injector has the APP_ROOT_SCOPE token and thus should provide
    // any injectable scoped to APP_ROOT_SCOPE.
    this.isRootInjector = this.records.has(APP_ROOT);

    // Eagerly instantiate the InjectorDefType classes themselves.
    this.injectorDefTypes.forEach(defType => this.get(defType));
  }

  /**
   * Destroy the injector and release references to every instance or provider associated with it.
   *
   * Also calls the `OnDestroy` lifecycle hooks of every instance that was created for which a
   * hook was found.
   */
  destroy(): void {
    this.assertNotDestroyed();

    // Set destroyed = true first, in case lifecycle hooks re-enter destroy().
    this.destroyed = true;
    try {
      // Call all the lifecycle hooks.
      this.onDestroy.forEach(service => service.ngOnDestroy());
    } finally {
      // Release all references.
      this.records.clear();
      this.onDestroy.clear();
      this.injectorDefTypes.clear();
    }
  }

  get<T>(
      token: Type<T>|InjectionToken<T>, notFoundValue: any = THROW_IF_NOT_FOUND,
      flags = InjectFlags.Default): T {
    this.assertNotDestroyed();
    // Set the injection context.
    const previousInjector = setCurrentInjector(this);
    try {
      // Check for the SkipSelf flag.
      if (!(flags & InjectFlags.SkipSelf)) {
        // SkipSelf isn't set, check if the record belongs to this injector.
        let record: Record<T>|undefined = this.records.get(token);
        if (record === undefined) {
          // No record, but maybe the token is scoped to this injector. Look for an ngInjectableDef
          // with a scope matching this injector.
          const def = couldBeInjectableType(token) &&
                  (token as InjectableType<any>| InjectableDefToken<any>).ngInjectableDef ||
              undefined;
          if (def !== undefined && this.injectableDefInScope(def)) {
            // Found an ngInjectableDef and it's scoped to this injector. Pretend as if it was here
            // all along.
            record = injectableDefRecord(token);
            this.records.set(token, record);
          }
        }
        // If a record was found, get the instance for it and return it.
        if (record !== undefined) {
          return this.hydrate(token, record);
        }
      }

      // Select the next injector based on the Self flag - if self is set, the next injector is
      // the NullInjector, otherwise it's the parent.
      let next = !(flags & InjectFlags.Self) ? this.parent : getNullInjector();
      return this.parent.get(token, notFoundValue);
    } finally {
      // Lastly, clean up the state by restoring the previous injector.
      setCurrentInjector(previousInjector);
    }
  }

  private assertNotDestroyed(): void {
    if (this.destroyed) {
      throw new Error('Injector has already been destroyed.');
    }
  }

  /**
   * Add an `InjectorDefType` or `InjectorDefTypeWithProviders` and all of its transitive providers
   * to this injector.
   */
  private processInjectorType(
      defOrWrappedDef: InjectorType<any>|InjectorTypeWithProviders<any>,
      parents: Set<InjectorType<any>>) {
    defOrWrappedDef = resolveForwardRef(defOrWrappedDef);

    // Either the defOrWrappedDef is an InjectorDefType (with ngInjectorDef) or an
    // InjectorDefTypeWithProviders (aka ModuleWithProviders). Detecting either is a megamorphic
    // read, so care is taken to only do the read once.

    // First attempt to read the ngInjectorDef.
    let def = (defOrWrappedDef as InjectorType<any>).ngInjectorDef as(InjectorDef<any>| undefined);

    // If that's not present, then attempt to read ngModule from the InjectorDefTypeWithProviders.
    const ngModule =
        (def == null) && (defOrWrappedDef as InjectorTypeWithProviders<any>).ngModule || undefined;

    // Determine the InjectorDefType. In the case where `defOrWrappedDef` is an `InjectorDefType`,
    // then this is easy. In the case of an InjectorDefTypeWithProviders, then the definition type
    // is the `ngModule`.
    const defType: InjectorType<any> =
        (ngModule === undefined) ? (defOrWrappedDef as InjectorType<any>) : ngModule;

    // If defOrWrappedType was an InjectorDefTypeWithProviders, then .providers may hold some
    // extra providers.
    const providers =
        (ngModule !== undefined) && (defOrWrappedDef as InjectorTypeWithProviders<any>).providers ||
        EMPTY_ARRAY;

    // Finally, if defOrWrappedType was an `InjectorDefTypeWithProviders`, then the actual
    // `InjectorDef` is on its `ngModule`.
    if (ngModule !== undefined) {
      def = ngModule.ngInjectorDef;
    }

    // If no definition was found, throw.
    if (def == null) {
      throw new Error(`Type ${stringify(defType)} is missing an ngInjectorDef definition.`);
    }

    // Check for circular dependencies.
    if (parents.has(defType)) {
      throw new Error(`Circular dependency: type ${stringify(defType)} ends up importing itself.`);
    }

    // Track the InjectorDefType and add a provider for it.
    this.injectorDefTypes.add(defType);
    this.records.set(defType, makeRecord(def.factory));

    // Add providers in the same way that @NgModule resolution did:

    // First, include providers from any imports.
    if (def.imports != null) {
      // Before processing defType's imports, add it to the set of parents. This way, if it ends
      // up deeply importing itself, this can be detected.
      parents.add(defType);
      try {
        deepForEach(def.imports, imported => this.processInjectorType(imported, parents));
      } finally {
        // Remove it from the parents set when finished.
        parents.delete(defType);
      }
    }

    // Next, include providers listed on the definition itself.
    if (def.providers != null) {
      deepForEach(def.providers, provider => this.processProvider(provider));
    }

    // Finally, include providers from an InjectorDefTypeWithProviders if there was one.
    deepForEach(providers, provider => this.processProvider(provider));
  }

  /**
   * Process a `SingleProvider` and add it.
   */
  private processProvider(provider: SingleProvider): void {
    // Determine the token from the provider. Either it's its own token, or has a {provide: ...}
    // property.
    provider = resolveForwardRef(provider);
    let token: any = isTypeProvider(provider) ? provider : resolveForwardRef(provider.provide);

    // Construct a `Record` for the provider.
    const record = providerToRecord(provider);

    if (!isTypeProvider(provider) && provider.multi === true) {
      // If the provider indicates that it's a multi-provider, process it specially.
      // First check whether it's been defined already.
      let multiRecord = this.records.get(token);
      if (multiRecord) {
        // It has. Throw a nice error if
        if (multiRecord.multi === undefined) {
          throw new Error(`Mixed multi-provider for ${token}.`);
        }
      } else {
        token = provider;
        multiRecord = makeRecord(undefined, NOT_YET, true);
        multiRecord.factory = () => injectArgs(multiRecord !.multi !);
        this.records.set(token, multiRecord);
      }
      token = provider;
      multiRecord.multi !.push(provider);
    }

    const existing = this.records.get(token);
    if (existing && existing.multi !== undefined) {
      throw new Error(`Mixed multi-provider for ${token}`);
    }

    this.records.set(token, record);
  }

  private hydrate<T>(token: Type<T>|InjectionToken<T>, record: Record<T>): T {
    if (record.value === CIRCULAR) {
      throw new Error(`Circular dep for ${stringify(token)}`);
    } else if (record.value === NOT_YET) {
      record.value = CIRCULAR;
      record.value = record.factory !();
    }
    if (typeof record.value === 'object' && record.value && hasOnDestroy(record.value)) {
      this.onDestroy.add(record.value);
    }
    return record.value as T;
  }

  private injectableDefInScope(def: InjectableDef<any>): boolean {
    if (!def.providedIn) {
      return false;
    } else if (typeof def.providedIn === 'string') {
      return def.providedIn === 'any' || (def.providedIn === 'root' && this.isRootInjector);
    } else {
      return this.injectorDefTypes.has(def.providedIn);
    }
  }
}

function injectableDefRecord(token: Type<any>| InjectionToken<any>): Record<any> {
  const def = (token as InjectableType<any>).ngInjectableDef;
  if (def === undefined) {
    throw new Error(`Type ${stringify(token)} is missing an ngInjectableDef definition.`);
  }
  return makeRecord(def.factory);
}

function providerToRecord(provider: SingleProvider): Record<any> {
  let token = resolveForwardRef(provider);
  let value: any = NOT_YET;
  let factory: (() => any)|undefined = undefined;
  if (isTypeProvider(provider)) {
    return injectableDefRecord(provider);
  } else {
    token = resolveForwardRef(provider.provide);
    if (isValueProvider(provider)) {
      value = provider.useValue;
    } else if (isExistingProvider(provider)) {
      factory = () => inject(provider.useExisting);
    } else if (isFactoryProvider(provider)) {
      factory = () => provider.useFactory(...injectArgs(provider.deps || []));
    } else {
      const classRef = (provider as StaticClassProvider | ClassProvider).useClass || token;
      if (hasDeps(provider)) {
        factory = () => new (classRef)(...injectArgs(provider.deps));
      } else {
        return injectableDefRecord(classRef);
      }
    }
  }
  return makeRecord(factory, value);
}

function makeRecord<T>(
    factory: (() => T) | undefined, value: T | {} = NOT_YET, multi: boolean = false): Record<T> {
  return {
    factory: factory,
    value: value,
    multi: multi ? [] : undefined,
  };
}

function deepForEach<T>(input: (T | any[])[], fn: (value: T) => void): void {
  input.forEach(value => Array.isArray(value) ? deepForEach(value, fn) : fn(value));
}

function isValueProvider(value: SingleProvider): value is ValueProvider {
  return USE_VALUE in value;
}

function isExistingProvider(value: SingleProvider): value is ExistingProvider {
  return !!(value as ExistingProvider).useExisting;
}

function isFactoryProvider(value: SingleProvider): value is FactoryProvider {
  return !!(value as FactoryProvider).useFactory;
}

function isClassProvider(value: SingleProvider): value is ClassProvider {
  return !!(value as ClassProvider).useClass;
}

function isTypeProvider(value: SingleProvider): value is TypeProvider {
  return typeof value === 'function';
}

function hasDeps(value: ClassProvider | ConstructorProvider | StaticClassProvider):
    value is ClassProvider&{deps: any[]} {
  return !!(value as any).deps;
}

function hasOnDestroy(value: any): value is OnDestroy {
  return typeof value === 'object' && value != null && (value as OnDestroy).ngOnDestroy &&
      typeof(value as OnDestroy).ngOnDestroy === 'function';
}

function couldBeInjectableType(value: any): value is Type<any>|InjectionToken<any> {
  return (typeof value === 'function') ||
      (typeof value === 'object' && value instanceof InjectionToken);
}
