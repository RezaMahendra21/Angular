/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

// We are temporarily importing the existing viewEngine from core so we can be sure we are
// correctly implementing its interfaces for backwards compatibility.
import {Type} from '../core';
import {Injector} from '../di/injector';
import {ComponentRef as viewEngine_ComponentRef} from '../linker/component_factory';

import {assertComponentType, assertNotNull} from './assert';
import {queueInitHooks, queueLifecycleHooks} from './hooks';
import {CLEAN_PROMISE, ROOT_DIRECTIVE_INDICES, _getComponentHostLElementNode, baseDirectiveCreate, createLView, createTView, detectChangesInternal, enterView, executeInitAndContentHooks, getRootView, hostElement, initChangeDetectorIfExisting, leaveView, locateHostElement, setHostBindings} from './instructions';
import {ComponentDef, ComponentType} from './interfaces/definition';
import {LElementNode, TNodeFlags} from './interfaces/node';
import {RElement, RendererFactory3, domRendererFactory3} from './interfaces/renderer';
import {LView, LViewFlags, RootContext} from './interfaces/view';
import {stringify} from './util';
import {createViewRef} from './view_ref';



/** Options that control how the component should be bootstrapped. */
export interface CreateComponentOptions {
  /** Which renderer factory to use. */
  rendererFactory?: RendererFactory3;

  /**
   * Host element on which the component will be bootstrapped. If not specified,
   * the component definition's `tag` is used to query the existing DOM for the
   * element to bootstrap.
   */
  host?: RElement|string;

  /** Module injector for the component. If unspecified, the injector will be NULL_INJECTOR. */
  injector?: Injector;

  /**
   * List of features to be applied to the created component. Features are simply
   * functions that decorate a component with a certain behavior.
   *
   * Typically, the features in this list are features that cannot be added to the
   * other features list in the component definition because they rely on other factors.
   *
   * Example: `RootLifecycleHooks` is a function that adds lifecycle hook capabilities
   * to root components in a tree-shakable way. It cannot be added to the component
   * features list because there's no way of knowing when the component will be used as
   * a root component.
   */
  hostFeatures?: (<T>(component: T, componentDef: ComponentDef<T>) => void)[];

  /**
   * A function which is used to schedule change detection work in the future.
   *
   * When marking components as dirty, it is necessary to schedule the work of
   * change detection in the future. This is done to coalesce multiple
   * {@link markDirty} calls into a single changed detection processing.
   *
   * The default value of the scheduler is the `requestAnimationFrame` function.
   *
   * It is also useful to override this function for testing purposes.
   */
  scheduler?: (work: () => void) => void;
}


/**
 * Bootstraps a component, then creates and returns a `ComponentRef` for that component.
 *
 * @param componentType Component to bootstrap
 * @param options Optional parameters which control bootstrapping
 */
export function createComponentRef<T>(
    componentType: ComponentType<T>, opts: CreateComponentOptions): viewEngine_ComponentRef<T> {
  const component = renderComponent(componentType, opts);
  const hostView = _getComponentHostLElementNode(component).data as LView;
  const hostViewRef = createViewRef(hostView, component);
  return {
    location: {nativeElement: getHostElement(component)},
    injector: opts.injector || NULL_INJECTOR,
    instance: component,
    hostView: hostViewRef,
    changeDetectorRef: hostViewRef,
    componentType: componentType,
    // TODO: implement destroy and onDestroy
    destroy: () => {},
    onDestroy: (cb: Function) => {}
  };
}


// TODO: A hack to not pull in the NullInjector from @angular/core.
export const NULL_INJECTOR: Injector = {
  get: (token: any, notFoundValue?: any) => {
    throw new Error('NullInjector: Not found: ' + stringify(token));
  }
};

/**
 * Bootstraps a Component into an existing host element and returns an instance
 * of the component.
 *
 * Use this function to bootstrap a component into the DOM tree. Each invocation
 * of this function will create a separate tree of components, injectors and
 * change detection cycles and lifetimes. To dynamically insert a new component
 * into an existing tree such that it shares the same injection, change detection
 * and object lifetime, use {@link ViewContainer#createComponent}.
 *
 * @param componentType Component to bootstrap
 * @param options Optional parameters which control bootstrapping
 */
export function renderComponent<T>(
    componentType: ComponentType<T>|
        Type<T>/* Type as workaround for: Microsoft/TypeScript/issues/4881 */
    ,
    opts: CreateComponentOptions = {}): T {
  ngDevMode && assertComponentType(componentType);
  const rendererFactory = opts.rendererFactory || domRendererFactory3;
  const componentDef = (componentType as ComponentType<T>).ngComponentDef as ComponentDef<T>;
  if (componentDef.type != componentType) componentDef.type = componentType;
  let component: T;
  // The first index of the first selector is the tag name.
  const componentTag = componentDef.selectors ![0] ![0] as string;
  const hostNode = locateHostElement(rendererFactory, opts.host || componentTag);
  const rootContext: RootContext = {
    // Incomplete initialization due to circular reference.
    component: null !,
    scheduler: opts.scheduler || requestAnimationFrame.bind(window),
    clean: CLEAN_PROMISE,
  };
  const rootView = createLView(
      -1, rendererFactory.createRenderer(hostNode, componentDef.rendererType),
      createTView(null, null), null, rootContext,
      componentDef.onPush ? LViewFlags.Dirty : LViewFlags.CheckAlways);

  const oldView = enterView(rootView, null !);
  let elementNode: LElementNode;
  try {
    if (rendererFactory.begin) rendererFactory.begin();

    // Create element node at index 0 in data array
    elementNode = hostElement(componentTag, hostNode, componentDef);

    // Create directive instance with factory() and store at index 0 in directives array
    component = rootContext.component =
        baseDirectiveCreate(0, componentDef.factory(), componentDef) as T;
    initChangeDetectorIfExisting(elementNode.nodeInjector, component, elementNode.data !);

    opts.hostFeatures && opts.hostFeatures.forEach((feature) => feature(component, componentDef));

    executeInitAndContentHooks();
    setHostBindings(ROOT_DIRECTIVE_INDICES);
    detectChangesInternal(elementNode.data as LView, elementNode, componentDef, component);
  } finally {
    leaveView(oldView);
    if (rendererFactory.end) rendererFactory.end();
  }

  return component;
}

/**
 * Used to enable lifecycle hooks on the root component.
 *
 * Include this feature when calling `renderComponent` if the root component
 * you are rendering has lifecycle hooks defined. Otherwise, the hooks won't
 * be called properly.
 *
 * Example:
 *
 * ```
 * renderComponent(AppComponent, {features: [RootLifecycleHooks]});
 * ```
 */
export function LifecycleHooksFeature(component: any, def: ComponentDef<any>): void {
  const elementNode = _getComponentHostLElementNode(component);

  // Root component is always created at dir index 0
  queueInitHooks(0, def.onInit, def.doCheck, elementNode.view.tView);
  queueLifecycleHooks(elementNode.tNode !.flags, elementNode.view);
}

/**
 * Retrieve the root context for any component by walking the parent `LView` until
 * reaching the root `LView`.
 *
 * @param component any component
 */
function getRootContext(component: any): RootContext {
  const rootContext = getRootView(component).context as RootContext;
  ngDevMode && assertNotNull(rootContext, 'rootContext');
  return rootContext;
}

/**
 * Retrieve the host element of the component.
 *
 * Use this function to retrieve the host element of the component. The host
 * element is the element which the component is associated with.
 *
 * @param component Component for which the host element should be retrieved.
 */
export function getHostElement<T>(component: T): HTMLElement {
  return _getComponentHostLElementNode(component).native as any;
}

/**
 * Retrieves the rendered text for a given component.
 *
 * This function retrieves the host element of a component and
 * and then returns the `textContent` for that element. This implies
 * that the text returned will include re-projected content of
 * the component as well.
 *
 * @param component The component to return the content text for.
 */
export function getRenderedText(component: any): string {
  const hostElement = getHostElement(component);
  return hostElement.textContent || '';
}

/**
 * Wait on component until it is rendered.
 *
 * This function returns a `Promise` which is resolved when the component's
 * change detection is executed. This is determined by finding the scheduler
 * associated with the `component`'s render tree and waiting until the scheduler
 * flushes. If nothing is scheduled, the function returns a resolved promise.
 *
 * Example:
 * ```
 * await whenRendered(myComponent);
 * ```
 *
 * @param component Component to wait upon
 * @returns Promise which resolves when the component is rendered.
 */
export function whenRendered(component: any): Promise<null> {
  return getRootContext(component).clean;
}
