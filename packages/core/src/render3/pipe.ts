/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {PipeTransform} from '../change_detection/pipe_transform';

import {getTView, load, store} from './instructions';
import {PipeDef, PipeDefList} from './interfaces/definition';
import {pureFunction1, pureFunction2, pureFunction3, pureFunction4, pureFunctionV} from './pure_function';

/**
 * Create a pipe.
 *
 * @param index Pipe index where the pipe will be stored.
 * @param pipeName The name of the pipe
 * @returns T the instance of the pipe.
 */
export function pipe(index: number, pipeName: string): any {
  const tView = getTView();
  let pipeDef: PipeDef<any>;

  if (tView.firstTemplatePass) {
    pipeDef = getPipeDef(pipeName, tView.pipeRegistry);
    tView.data[index] = pipeDef;
    if (pipeDef.onDestroy) {
      (tView.pipeDestroyHooks || (tView.pipeDestroyHooks = [])).push(index, pipeDef.onDestroy);
    }
  } else {
    pipeDef = tView.data[index] as PipeDef<any>;
  }

  const pipeInstance = pipeDef.n();
  store(index, pipeInstance);
  return pipeInstance;
}

/**
 * Searches the pipe registry for a pipe with the given name. If one is found,
 * returns the pipe. Otherwise, an error is thrown because the pipe cannot be resolved.
 *
 * @param name Name of pipe to resolve
 * @param registry Full list of available pipes
 * @returns Matching PipeDef
 */
function getPipeDef(name: string, registry: PipeDefList | null): PipeDef<any> {
  if (registry) {
    for (let i = 0; i < registry.length; i++) {
      const pipeDef = registry[i];
      if (name === pipeDef.name) {
        return pipeDef;
      }
    }
  }
  throw new Error(`Pipe with name '${name}' not found!`);
}

/**
 * Invokes a pipe with 1 arguments.
 *
 * This instruction acts as a guard to {@link PipeTransform#transform} invoking
 * the pipe only when an input to the pipe changes.
 *
 * @param index Pipe index where the pipe was stored on creation.
 * @param v1 1st argument to {@link PipeTransform#transform}.
 */
export function pipeBind1(index: number, v1: any): any {
  const pipeInstance = load<PipeTransform>(index);
  return isPure(index) ? pureFunction1(pipeInstance.transform, v1, pipeInstance) :
                         pipeInstance.transform(v1);
}

/**
 * Invokes a pipe with 2 arguments.
 *
 * This instruction acts as a guard to {@link PipeTransform#transform} invoking
 * the pipe only when an input to the pipe changes.
 *
 * @param index Pipe index where the pipe was stored on creation.
 * @param v1 1st argument to {@link PipeTransform#transform}.
 * @param v2 2nd argument to {@link PipeTransform#transform}.
 */
export function pipeBind2(index: number, v1: any, v2: any): any {
  const pipeInstance = load<PipeTransform>(index);
  return isPure(index) ? pureFunction2(pipeInstance.transform, v1, v2, pipeInstance) :
                         pipeInstance.transform(v1, v2);
}

/**
 * Invokes a pipe with 3 arguments.
 *
 * This instruction acts as a guard to {@link PipeTransform#transform} invoking
 * the pipe only when an input to the pipe changes.
 *
 * @param index Pipe index where the pipe was stored on creation.
 * @param v1 1st argument to {@link PipeTransform#transform}.
 * @param v2 2nd argument to {@link PipeTransform#transform}.
 * @param v3 4rd argument to {@link PipeTransform#transform}.
 */
export function pipeBind3(index: number, v1: any, v2: any, v3: any): any {
  const pipeInstance = load<PipeTransform>(index);
  return isPure(index) ? pureFunction3(pipeInstance.transform.bind(pipeInstance), v1, v2, v3) :
                         pipeInstance.transform(v1, v2, v3);
}

/**
 * Invokes a pipe with 4 arguments.
 *
 * This instruction acts as a guard to {@link PipeTransform#transform} invoking
 * the pipe only when an input to the pipe changes.
 *
 * @param index Pipe index where the pipe was stored on creation.
 * @param v1 1st argument to {@link PipeTransform#transform}.
 * @param v2 2nd argument to {@link PipeTransform#transform}.
 * @param v3 3rd argument to {@link PipeTransform#transform}.
 * @param v4 4th argument to {@link PipeTransform#transform}.
 */
export function pipeBind4(index: number, v1: any, v2: any, v3: any, v4: any): any {
  const pipeInstance = load<PipeTransform>(index);
  return isPure(index) ? pureFunction4(pipeInstance.transform, v1, v2, v3, v4, pipeInstance) :
                         pipeInstance.transform(v1, v2, v3, v4);
}

/**
 * Invokes a pipe with variable number of arguments.
 *
 * This instruction acts as a guard to {@link PipeTransform#transform} invoking
 * the pipe only when an input to the pipe changes.
 *
 * @param index Pipe index where the pipe was stored on creation.
 * @param values Array of arguments to pass to {@link PipeTransform#transform} method.
 */
export function pipeBindV(index: number, values: any[]): any {
  const pipeInstance = load<PipeTransform>(index);
  return isPure(index) ? pureFunctionV(pipeInstance.transform, values, pipeInstance) :
                         pipeInstance.transform.apply(pipeInstance, values);
}

function isPure(index: number): boolean {
  return (<PipeDef<any>>getTView().data[index]).pure;
}
