/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Injectable, InjectionToken, StaticProvider} from '../di';
import {MissingTranslationStrategy} from '../i18n/tokens';
import {ViewEncapsulation} from '../metadata';
import {Type} from '../type';

import {ComponentFactory} from './component_factory';
import {NgModuleFactory} from './ng_module_factory';


/**
 * Combination of NgModuleFactory and ComponentFactorys.
 *
 * @experimental
 */
export class ModuleWithComponentFactories<T> {
  constructor(
      public ngModuleFactory: NgModuleFactory<T>,
      public componentFactories: ComponentFactory<any>[]) {}
}


function _throwError() {
  throw new Error(`Runtime compiler is not loaded`);
}

/**
 * Low-level service for running the angular compiler during runtime
 * to create {@link ComponentFactory}s, which
 * can later be used to create and render a Component instance.
 *
 * Each `@NgModule` provides an own `Compiler` to its injector,
 * that will use the directives/pipes of the ng module for compilation
 * of components.
 *
 */
@Injectable()
export class Compiler {
  /**
   * Compiles the given NgModule and all of its components. All templates of the components listed
   * in `entryComponents` have to be inlined.
   */
  compileModuleSync<T>(moduleType: Type<T>): NgModuleFactory<T> { throw _throwError(); }

  /**
   * Compiles the given NgModule and all of its components
   */
  compileModuleAsync<T>(moduleType: Type<T>): Promise<NgModuleFactory<T>> { throw _throwError(); }

  /**
   * Same as {@link #compileModuleSync} but also creates ComponentFactories for all components.
   */
  compileModuleAndAllComponentsSync<T>(moduleType: Type<T>): ModuleWithComponentFactories<T> {
    throw _throwError();
  }

  /**
   * Same as {@link #compileModuleAsync} but also creates ComponentFactories for all components.
   */
  compileModuleAndAllComponentsAsync<T>(moduleType: Type<T>):
      Promise<ModuleWithComponentFactories<T>> {
    throw _throwError();
  }

  /**
   * Clears all caches.
   */
  clearCache(): void {}

  /**
   * Clears the cache for the given component/ngModule.
   */
  clearCacheFor(type: Type<any>) {}
}

/**
 * Options for creating a compiler
 *
 * @experimental
 */
export type CompilerOptions = {
  useJit?: boolean,
  defaultEncapsulation?: ViewEncapsulation,
  providers?: StaticProvider[],
  missingTranslation?: MissingTranslationStrategy,
  preserveWhitespaces?: boolean,
};

/**
 * Token to provide CompilerOptions in the platform injector.
 *
 * @experimental
 */
export const COMPILER_OPTIONS = new InjectionToken<CompilerOptions[]>('compilerOptions');

/**
 * A factory for creating a Compiler
 *
 * @experimental
 */
export abstract class CompilerFactory {
  abstract createCompiler(options?: CompilerOptions[]): Compiler;
}
