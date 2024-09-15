/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {NgModuleRef} from '@angular/core';
import {InjectableDef, defineInjectable} from '@angular/core/src/di/defs';
import {INJECTOR, InjectFlags, Injector, inject} from '@angular/core/src/di/injector';
import {makePropDecorator} from '@angular/core/src/util/decorators';
import {NgModuleDefinition, NgModuleProviderDef, NodeFlags} from '@angular/core/src/view';
import {moduleDef, moduleProvideDef, resolveNgModuleDep} from '@angular/core/src/view/ng_module';
import {createNgModuleRef} from '@angular/core/src/view/refs';
import {tokenKey} from '@angular/core/src/view/util';

class Foo {}

class MyModule {}

class MyChildModule {}

class NotMyModule {}

class Bar {
  static ngInjectableDef: InjectableDef<Bar> = defineInjectable({
    factory: () => new Bar(),
    providedIn: MyModule,
  });
}

class Baz {
  static ngInjectableDef: InjectableDef<Baz> = defineInjectable({
    factory: () => new Baz(),
    providedIn: NotMyModule,
  });
}

class HasNormalDep {
  constructor(public foo: Foo) {}

  static ngInjectableDef: InjectableDef<HasNormalDep> = defineInjectable({
    factory: () => new HasNormalDep(inject(Foo)),
    providedIn: MyModule,
  });
}

class HasDefinedDep {
  constructor(public bar: Bar) {}

  static ngInjectableDef: InjectableDef<HasDefinedDep> = defineInjectable({
    factory: () => new HasDefinedDep(inject(Bar)),
    providedIn: MyModule,
  });
}

class HasOptionalDep {
  constructor(public baz: Baz|null) {}

  static ngInjectableDef: InjectableDef<HasOptionalDep> = defineInjectable({
    factory: () => new HasOptionalDep(inject(Baz, null)),
    providedIn: MyModule,
  });
}

class ChildDep {
  static ngInjectableDef: InjectableDef<ChildDep> = defineInjectable({
    factory: () => new ChildDep(),
    providedIn: MyChildModule,
  });
}

class FromChildWithOptionalDep {
  constructor(public baz: Baz|null) {}
  static ngInjectableDef: InjectableDef<FromChildWithOptionalDep> = defineInjectable({
    factory: () => new FromChildWithOptionalDep(inject(Baz, null, InjectFlags.Default)),
    providedIn: MyChildModule,
  });
}

class FromChildWithSkipSelfDep {
  constructor(public depFromParent: ChildDep|null, public depFromChild: Bar|null) {}
  static ngInjectableDef: InjectableDef<FromChildWithSkipSelfDep> = defineInjectable({
    factory: () => new FromChildWithSkipSelfDep(
                 inject(ChildDep, null, InjectFlags.SkipSelf), inject(Bar, null, InjectFlags.Self)),
    providedIn: MyChildModule,
  });
}

class UsesInject {
  constructor() { inject(INJECTOR); }
}

function makeProviders(classes: any[], modules: any[]): NgModuleDefinition {
  const providers =
      classes.map((token, index) => ({
                    index,
                    deps: [],
                    flags: NodeFlags.TypeClassProvider | NodeFlags.LazyProvider, token,
                    value: token,
                  }));
  const providersByKey: {[key: string]: NgModuleProviderDef} = {};
  providers.forEach(provider => providersByKey[tokenKey(provider.token)] = provider);
  return {factory: null, providers, providersByKey, modules, isRoot: true};
}

describe('NgModuleRef_ injector', () => {
  let ref: NgModuleRef<any>;
  let childRef: NgModuleRef<any>;
  beforeEach(() => {
    ref = createNgModuleRef(
        MyModule, Injector.NULL, [], makeProviders([MyModule, Foo, UsesInject], [MyModule]));
    childRef = createNgModuleRef(
        MyChildModule, ref.injector, [], makeProviders([MyChildModule], [MyChildModule]));
  });

  it('injects a provided value',
     () => { expect(ref.injector.get(Foo) instanceof Foo).toBeTruthy(); });

  it('injects an InjectableDef value',
     () => { expect(ref.injector.get(Bar) instanceof Bar).toBeTruthy(); });

  it('caches InjectableDef values',
     () => { expect(ref.injector.get(Bar)).toBe(ref.injector.get(Bar)); });

  it('injects provided deps properly', () => {
    const instance = ref.injector.get(HasNormalDep);
    expect(instance instanceof HasNormalDep).toBeTruthy();
    expect(instance.foo).toBe(ref.injector.get(Foo));
  });

  it('injects defined deps properly', () => {
    const instance = ref.injector.get(HasDefinedDep);
    expect(instance instanceof HasDefinedDep).toBeTruthy();
    expect(instance.bar).toBe(ref.injector.get(Bar));
  });

  it('injects optional deps properly', () => {
    const instance = ref.injector.get(HasOptionalDep);
    expect(instance instanceof HasOptionalDep).toBeTruthy();
    expect(instance.baz).toBeNull();
  });

  it('injects skip-self and self deps across injectors properly', () => {
    const instance = childRef.injector.get(FromChildWithSkipSelfDep);
    expect(instance instanceof FromChildWithSkipSelfDep).toBeTruthy();
    expect(instance.depFromParent).toBeNull();
    expect(instance.depFromChild instanceof Bar).toBeTruthy();
  });

  it('does not inject something not scoped to the module',
     () => { expect(ref.injector.get(Baz, null)).toBeNull(); });

  it('injects with the current injector always set',
     () => { expect(() => ref.injector.get(UsesInject)).not.toThrow(); });
});
