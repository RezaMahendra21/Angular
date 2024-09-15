/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import './ng_dev_mode';

import {assertEqual, assertLessThan, assertNotEqual, assertNotNull, assertNull, assertSame} from './assert';
import {LContainer, TContainer} from './interfaces/container';
import {LInjector} from './interfaces/injector';
import {CssSelectorList, LProjection, NG_PROJECT_AS_ATTR_NAME} from './interfaces/projection';
import {LQueries} from './interfaces/query';
import {CurrentMatchesList, LView, LViewFlags, LifecycleStage, RootContext, TData, TView} from './interfaces/view';

import {LContainerNode, LElementNode, LNode, LNodeType, TNodeFlags, LProjectionNode, LTextNode, LViewNode, TNode, TContainerNode, InitialInputData, InitialInputs, PropertyAliases, PropertyAliasValue,} from './interfaces/node';
import {assertNodeType} from './node_assert';
import {appendChild, insertChild, insertView, appendProjectedNode, removeView, canInsertNativeNode, createTextNode} from './node_manipulation';
import {isNodeMatchingSelectorList, matchingSelectorIndex} from './node_selector_matcher';
import {ComponentDef, ComponentTemplate, ComponentType, DirectiveDef, DirectiveDefList, DirectiveDefListOrFactory, DirectiveType, PipeDef, PipeDefListOrFactory, RenderFlags} from './interfaces/definition';
import {RElement, RText, Renderer3, RendererFactory3, ProceduralRenderer3, ObjectOrientedRenderer3, RendererStyleFlags3, isProceduralRenderer} from './interfaces/renderer';
import {isDifferent, stringify} from './util';
import {executeHooks, queueLifecycleHooks, queueInitHooks, executeInitHooks} from './hooks';
import {ViewRef} from './view_ref';
import {throwCyclicDependencyError, throwErrorIfNoChangesMode, throwMultipleComponentError} from './errors';

/**
 * Directive (D) sets a property on all component instances using this constant as a key and the
 * component's host node (LElement) as the value. This is used in methods like detectChanges to
 * facilitate jumping from an instance to the host node.
 */
export const NG_HOST_SYMBOL = '__ngHostLNode__';

/**
 * A permanent marker promise which signifies that the current CD tree is
 * clean.
 */
const _CLEAN_PROMISE = Promise.resolve(null);

/**
 * Function used to sanitize the value before writing it into the renderer.
 */
export type Sanitizer = (value: any) => string;

/**
 * Directive and element indices for top-level directive.
 *
 * Saved here to avoid re-instantiating an array on every change detection run.
 */
export const _ROOT_DIRECTIVE_INDICES = [0, 0];

/**
 * Token set in currentMatches while dependencies are being resolved.
 *
 * If we visit a directive that has a value set to CIRCULAR, we know we've
 * already seen it, and thus have a circular dependency.
 */
export const CIRCULAR = '__CIRCULAR__';

/**
 * This property gets set before entering a template.
 *
 * This renderer can be one of two varieties of Renderer3:
 *
 * - ObjectedOrientedRenderer3
 *
 * This is the native browser API style, e.g. operations are methods on individual objects
 * like HTMLElement. With this style, no additional code is needed as a facade (reducing payload
 * size).
 *
 * - ProceduralRenderer3
 *
 * In non-native browser environments (e.g. platforms such as web-workers), this is the facade
 * that enables element manipulation. This also facilitates backwards compatibility with
 * Renderer2.
 */
let renderer: Renderer3;
let rendererFactory: RendererFactory3;

export function getRenderer(): Renderer3 {
  // top level variables should not be exported for performance reason (PERF_NOTES.md)
  return renderer;
}

/** Used to set the parent property when nodes are created. */
let previousOrParentNode: LNode;

export function getPreviousOrParentNode(): LNode {
  // top level variables should not be exported for performance reason (PERF_NOTES.md)
  return previousOrParentNode;
}

/**
 * If `isParent` is:
 *  - `true`: then `previousOrParentNode` points to a parent node.
 *  - `false`: then `previousOrParentNode` points to previous node (sibling).
 */
let isParent: boolean;

/**
 * Static data that corresponds to the instance-specific data array on an LView.
 *
 * Each node's static data is stored in tData at the same index that it's stored
 * in the data array. Any nodes that do not have static data store a null value in
 * tData to avoid a sparse array.
 */
let tData: TData;

/**
 * State of the current view being processed.
 *
 * NOTE: we cheat here and initialize it to `null` even thought the type does not
 * contain `null`. This is because we expect this value to be not `null` as soon
 * as we enter the view. Declaring the type as `null` would require us to place `!`
 * in most instructions since they all assume that `currentView` is defined.
 */
let currentView: LView = null !;

let currentQueries: LQueries|null;

export function getCurrentQueries(QueryType: {new (): LQueries}): LQueries {
  // top level variables should not be exported for performance reason (PERF_NOTES.md)
  return currentQueries || (currentQueries = new QueryType());
}

/**
 * This property gets set before entering a template.
 */
let creationMode: boolean;

export function getCreationMode(): boolean {
  // top level variables should not be exported for performance reason (PERF_NOTES.md)
  return creationMode;
}

/**
 * An array of nodes (text, element, container, etc), pipes, their bindings, and
 * any local variables that need to be stored between invocations.
 */
let data: any[];

/**
 * An array of directive instances in the current view.
 *
 * These must be stored separately from LNodes because their presence is
 * unknown at compile-time and thus space cannot be reserved in data[].
 */
let directives: any[]|null;

/**
 * When a view is destroyed, listeners need to be released and outputs need to be
 * unsubscribed. This cleanup array stores both listener data (in chunks of 4)
 * and output data (in chunks of 2) for a particular view. Combining the arrays
 * saves on memory (70 bytes per array) and on a few bytes of code size (for two
 * separate for loops).
 *
 * If it's a listener being stored:
 * 1st index is: event name to remove
 * 2nd index is: native element
 * 3rd index is: listener function
 * 4th index is: useCapture boolean
 *
 * If it's an output subscription:
 * 1st index is: unsubscribe function
 * 2nd index is: context for function
 */
let cleanup: any[]|null;

/**
 * In this mode, any changes in bindings will throw an ExpressionChangedAfterChecked error.
 *
 * Necessary to support ChangeDetectorRef.checkNoChanges().
 */
let checkNoChangesMode = false;

/** Whether or not this is the first time the current view has been processed. */
let firstTemplatePass = true;

const enum BindingDirection {
  Input,
  Output,
}

/**
 * Swap the current state with a new state.
 *
 * For performance reasons we store the state in the top level of the module.
 * This way we minimize the number of properties to read. Whenever a new view
 * is entered we have to store the state for later, and when the view is
 * exited the state has to be restored
 *
 * @param newView New state to become active
 * @param host Element to which the View is a child of
 * @returns the previous state;
 */
export function enterView(newView: LView, host: LElementNode | LViewNode | null): LView {
  const oldView: LView = currentView;
  data = newView && newView.data;
  directives = newView && newView.directives;
  tData = newView && newView.tView.data;
  creationMode = newView && (newView.flags & LViewFlags.CreationMode) === LViewFlags.CreationMode;
  firstTemplatePass = newView && newView.tView.firstTemplatePass;

  cleanup = newView && newView.cleanup;
  renderer = newView && newView.renderer;

  if (newView && newView.bindingIndex < 0) {
    newView.bindingIndex = newView.bindingStartIndex;
  }

  if (host != null) {
    previousOrParentNode = host;
    isParent = true;
  }

  currentView = newView;
  currentQueries = newView && newView.queries;

  return oldView;
}

/**
 * Used in lieu of enterView to make it clear when we are exiting a child view. This makes
 * the direction of traversal (up or down the view tree) a bit clearer.
 */
export function leaveView(newView: LView): void {
  if (!checkNoChangesMode) {
    executeHooks(
        directives !, currentView.tView.viewHooks, currentView.tView.viewCheckHooks, creationMode);
  }
  // Views should be clean and in update mode after being checked, so these bits are cleared
  currentView.flags &= ~(LViewFlags.CreationMode | LViewFlags.Dirty);
  currentView.lifecycleStage = LifecycleStage.INIT;
  currentView.bindingIndex = -1;
  enterView(newView, null);
}

/**  Refreshes directives in this view and triggers any init/content hooks.  */
function refreshDirectives() {
  executeInitAndContentHooks();

  const tView = currentView.tView;
  // This needs to be set before children are processed to support recursive components
  tView.firstTemplatePass = firstTemplatePass = false;

  setHostBindings(tView.hostBindings);
  refreshChildComponents(tView.components);
}

/** Sets the host bindings for the current view. */
export function setHostBindings(bindings: number[] | null): void {
  if (bindings != null) {
    const defs = currentView.tView.directives !;
    for (let i = 0; i < bindings.length; i += 2) {
      const dirIndex = bindings[i];
      const def = defs[dirIndex] as DirectiveDef<any>;
      def.hostBindings && def.hostBindings(dirIndex, bindings[i + 1]);
    }
  }
}

/** Refreshes child components in the current view. */
function refreshChildComponents(components: number[] | null): void {
  if (components != null) {
    for (let i = 0; i < components.length; i += 2) {
      componentRefresh(components[i], components[i + 1]);
    }
  }
}

export function executeInitAndContentHooks(): void {
  if (!checkNoChangesMode) {
    const tView = currentView.tView;
    executeInitHooks(currentView, tView, creationMode);
    executeHooks(directives !, tView.contentHooks, tView.contentCheckHooks, creationMode);
  }
}

export function createLView<T>(
    viewId: number, renderer: Renderer3, tView: TView, template: ComponentTemplate<T>| null,
    context: T | null, flags: LViewFlags): LView {
  const newView = {
    parent: currentView,
    id: viewId,  // -1 for component views
    flags: flags | LViewFlags.CreationMode | LViewFlags.Attached,
    node: null !,  // until we initialize it in createNode.
    data: [],
    directives: null,
    tView: tView,
    cleanup: null,
    renderer: renderer,
    child: null,
    tail: null,
    next: null,
    bindingStartIndex: -1,
    bindingIndex: -1,
    template: template,
    context: context,
    dynamicViewCount: 0,
    lifecycleStage: LifecycleStage.INIT,
    queries: null,
  };

  return newView;
}

/**
 * Creation of LNode object is extracted to a separate function so we always create LNode object
 * with the same shape
 * (same properties assigned in the same order).
 */
export function createLNodeObject(
    type: LNodeType, currentView: LView, parent: LNode, native: RText | RElement | null | undefined,
    state: any,
    queries: LQueries | null): LElementNode&LTextNode&LViewNode&LContainerNode&LProjectionNode {
  return {
    type: type,
    native: native as any,
    view: currentView,
    parent: parent as any,
    child: null,
    next: null,
    nodeInjector: parent ? parent.nodeInjector : null,
    data: state,
    queries: queries,
    tNode: null,
    pNextOrParent: null,
    dynamicLContainerNode: null
  };
}

/**
 * A common way of creating the LNode to make sure that all of them have same shape to
 * keep the execution code monomorphic and fast.
 */
export function createLNode(
    index: number | null, type: LNodeType.Element, native: RElement | RText | null,
    lView?: LView | null): LElementNode;
export function createLNode(
    index: null, type: LNodeType.View, native: null, lView: LView): LViewNode;
export function createLNode(
    index: number, type: LNodeType.Container, native: undefined,
    lContainer: LContainer): LContainerNode;
export function createLNode(
    index: number, type: LNodeType.Projection, native: null,
    lProjection: LProjection): LProjectionNode;
export function createLNode(
    index: number | null, type: LNodeType, native: RText | RElement | null | undefined,
    state?: null | LView | LContainer | LProjection): LElementNode&LTextNode&LViewNode&
    LContainerNode&LProjectionNode {
  const parent = isParent ? previousOrParentNode :
                            previousOrParentNode && previousOrParentNode.parent as LNode;
  let queries =
      (isParent ? currentQueries : previousOrParentNode && previousOrParentNode.queries) ||
      parent && parent.queries && parent.queries.child();
  const isState = state != null;
  const node =
      createLNodeObject(type, currentView, parent, native, isState ? state as any : null, queries);

  if ((type & LNodeType.ViewOrElement) === LNodeType.ViewOrElement && isState) {
    // Bit of a hack to bust through the readonly because there is a circular dep between
    // LView and LNode.
    ngDevMode && assertNull((state as LView).node, 'LView.node should not have been initialized');
    (state as LView as{node: LNode}).node = node;
  }
  if (index != null) {
    // We are Element or Container
    ngDevMode && assertDataNext(index);
    data[index] = node;

    // Every node adds a value to the static data array to avoid a sparse array
    if (index >= tData.length) {
      tData[index] = null;
    } else {
      node.tNode = tData[index] as TNode;
    }

    // Now link ourselves into the tree.
    if (isParent) {
      currentQueries = null;
      if (previousOrParentNode.view === currentView ||
          previousOrParentNode.type === LNodeType.View) {
        // We are in the same view, which means we are adding content node to the parent View.
        ngDevMode && assertNull(
                         previousOrParentNode.child,
                         `previousOrParentNode's child should not have been set.`);
        previousOrParentNode.child = node;
      } else {
        // We are adding component view, so we don't link parent node child to this node.
      }
    } else if (previousOrParentNode) {
      ngDevMode && assertNull(
                       previousOrParentNode.next,
                       `previousOrParentNode's next property should not have been set ${index}.`);
      previousOrParentNode.next = node;
      if (previousOrParentNode.dynamicLContainerNode) {
        previousOrParentNode.dynamicLContainerNode.next = node;
      }
    }
  }
  previousOrParentNode = node;
  isParent = true;
  return node;
}


//////////////////////////
//// Render
//////////////////////////

/**
 * Resets the application state.
 */
function resetApplicationState() {
  isParent = false;
  previousOrParentNode = null !;
}

/**
 *
 * @param hostNode Existing node to render into.
 * @param template Template function with the instructions.
 * @param context to pass into the template.
 * @param providedRendererFactory renderer factory to use
 * @param host The host element node to use
 * @param directives Directive defs that should be used for matching
 * @param pipes Pipe defs that should be used for matching
 */
export function renderTemplate<T>(
    hostNode: RElement, template: ComponentTemplate<T>, context: T,
    providedRendererFactory: RendererFactory3, host: LElementNode | null,
    directives?: DirectiveDefListOrFactory | null,
    pipes?: PipeDefListOrFactory | null): LElementNode {
  if (host == null) {
    resetApplicationState();
    rendererFactory = providedRendererFactory;
    const tView = getOrCreateTView(template, directives || null, pipes || null);
    host = createLNode(
        null, LNodeType.Element, hostNode,
        createLView(
            -1, providedRendererFactory.createRenderer(null, null), tView, null, {},
            LViewFlags.CheckAlways));
  }
  const hostView = host.data !;
  ngDevMode && assertNotNull(hostView, 'Host node should have an LView defined in host.data.');
  renderComponentOrTemplate(host, hostView, context, template);
  return host;
}

export function renderEmbeddedTemplate<T>(
    viewNode: LViewNode | null, template: ComponentTemplate<T>, context: T,
    renderer: Renderer3): LViewNode {
  const _isParent = isParent;
  const _previousOrParentNode = previousOrParentNode;
  let oldView: LView;
  try {
    isParent = true;
    previousOrParentNode = null !;
    let rf: RenderFlags = RenderFlags.Update;
    if (viewNode == null) {
      // TODO: revisit setting currentView when re-writing view containers
      const directives = currentView && currentView.tView.directiveRegistry;
      const pipes = currentView && currentView.tView.pipeRegistry;

      const tView = getOrCreateTView(template, directives, pipes);
      const lView = createLView(-1, renderer, tView, template, context, LViewFlags.CheckAlways);

      viewNode = createLNode(null, LNodeType.View, null, lView);
      rf = RenderFlags.Create;
    }
    oldView = enterView(viewNode.data, viewNode);

    template(rf, context);
    refreshDirectives();
    refreshDynamicChildren();

  } finally {
    leaveView(oldView !);
    isParent = _isParent;
    previousOrParentNode = _previousOrParentNode;
  }
  return viewNode;
}

export function renderComponentOrTemplate<T>(
    node: LElementNode, hostView: LView, componentOrContext: T, template?: ComponentTemplate<T>) {
  const oldView = enterView(hostView, node);
  try {
    if (rendererFactory.begin) {
      rendererFactory.begin();
    }
    if (template) {
      template(getRenderFlags(hostView), componentOrContext !);
      refreshDynamicChildren();
      refreshDirectives();
    } else {
      executeInitAndContentHooks();

      // Element was stored at 0 in data and directive was stored at 0 in directives
      // in renderComponent()
      setHostBindings(_ROOT_DIRECTIVE_INDICES);
      componentRefresh(0, 0);
    }
  } finally {
    if (rendererFactory.end) {
      rendererFactory.end();
    }
    leaveView(oldView);
  }
}

/**
 * This function returns the default configuration of rendering flags depending on when the
 * template is in creation mode or update mode. By default, the update block is run with the
 * creation block when the view is in creation mode. Otherwise, the update block is run
 * alone.
 *
 * Dynamically created views do NOT use this configuration (update block and create block are
 * always run separately).
 */
function getRenderFlags(view: LView): RenderFlags {
  return view.flags & LViewFlags.CreationMode ? RenderFlags.Create | RenderFlags.Update :
                                                RenderFlags.Update;
}

//////////////////////////
//// Element
//////////////////////////

/**
 * Create DOM element. The instruction must later be followed by `elementEnd()` call.
 *
 * @param index Index of the element in the data array
 * @param name Name of the DOM Node
 * @param attrs Statically bound set of attributes to be written into the DOM element on creation.
 * @param localRefs A set of local reference bindings on the element.
 *
 * Attributes and localRefs are passed as an array of strings where elements with an even index
 * hold an attribute name and elements with an odd index hold an attribute value, ex.:
 * ['id', 'warning5', 'class', 'alert']
 */
export function elementStart(
    index: number, name: string, attrs?: string[] | null, localRefs?: string[] | null): RElement {
  ngDevMode &&
      assertEqual(
          currentView.bindingStartIndex, -1, 'elements should be created before any bindings');

  const native: RElement = renderer.createElement(name);
  const node: LElementNode = createLNode(index, LNodeType.Element, native !, null);

  if (attrs) setUpAttributes(native, attrs);
  appendChild(node.parent !, native, currentView);
  createDirectivesAndLocals(index, name, attrs, localRefs, null);
  return native;
}

function createDirectivesAndLocals(
    index: number, name: string | null, attrs: string[] | null | undefined,
    localRefs: string[] | null | undefined, containerData: TView[] | null) {
  const node = previousOrParentNode;
  if (firstTemplatePass) {
    ngDevMode && assertDataInRange(index - 1);
    node.tNode = tData[index] = createTNode(name, attrs || null, containerData);
    cacheMatchingDirectivesForNode(node.tNode, currentView.tView, localRefs || null);
  } else {
    instantiateDirectivesDirectly();
  }
  saveResolvedLocalsInData();
}

/**
 * On first template pass, we match each node against available directive selectors and save
 * the resulting defs in the correct instantiation order for subsequent change detection runs
 * (so dependencies are always created before the directives that inject them).
 */
function cacheMatchingDirectivesForNode(
    tNode: TNode, tView: TView, localRefs: string[] | null): void {
  const exportsMap = localRefs ? {'': -1} : null;
  const matches = tView.currentMatches = findDirectiveMatches(tNode);
  if (matches) {
    for (let i = 0; i < matches.length; i += 2) {
      const def = matches[i] as DirectiveDef<any>;
      const valueIndex = i + 1;
      resolveDirective(def, valueIndex, matches, tView);
      saveNameToExportMap(matches[valueIndex] as number, def, exportsMap);
    }
  }
  if (exportsMap) cacheMatchingLocalNames(tNode, localRefs, exportsMap);
}

/** Matches the current node against all available selectors. */
function findDirectiveMatches(tNode: TNode): CurrentMatchesList|null {
  const registry = currentView.tView.directiveRegistry;
  let matches: any[]|null = null;
  if (registry) {
    for (let i = 0; i < registry.length; i++) {
      const def = registry[i];
      if (isNodeMatchingSelectorList(tNode, def.selectors !)) {
        if ((def as ComponentDef<any>).template) {
          if (tNode.flags & TNodeFlags.Component) throwMultipleComponentError(tNode);
          tNode.flags = TNodeFlags.Component;
        }
        if (def.diPublic) def.diPublic(def);
        (matches || (matches = [])).push(def, null);
      }
    }
  }
  return matches as CurrentMatchesList;
}

export function resolveDirective(
    def: DirectiveDef<any>, valueIndex: number, matches: CurrentMatchesList, tView: TView): any {
  if (matches[valueIndex] === null) {
    matches[valueIndex] = CIRCULAR;
    const instance = def.factory();
    (tView.directives || (tView.directives = [])).push(def);
    return directiveCreate(matches[valueIndex] = tView.directives !.length - 1, instance, def);
  } else if (matches[valueIndex] === CIRCULAR) {
    // If we revisit this directive before it's resolved, we know it's circular
    throwCyclicDependencyError(def.type);
  }
  return null;
}

/** Stores index of component's host element so it will be queued for view refresh during CD. */
function queueComponentIndexForCheck(dirIndex: number): void {
  if (firstTemplatePass) {
    (currentView.tView.components || (currentView.tView.components = [
     ])).push(dirIndex, data.length - 1);
  }
}

/** Stores index of directive and host element so it will be queued for binding refresh during CD.
 */
function queueHostBindingForCheck(dirIndex: number): void {
  ngDevMode &&
      assertEqual(firstTemplatePass, true, 'Should only be called in first template pass.');
  (currentView.tView.hostBindings || (currentView.tView.hostBindings = [
   ])).push(dirIndex, data.length - 1);
}

/** Sets the context for a ChangeDetectorRef to the given instance. */
export function initChangeDetectorIfExisting(
    injector: LInjector | null, instance: any, view: LView): void {
  if (injector && injector.changeDetectorRef != null) {
    (injector.changeDetectorRef as ViewRef<any>)._setComponentContext(view, instance);
  }
}

export function isComponent(tNode: TNode): boolean {
  return (tNode.flags & TNodeFlags.Component) === TNodeFlags.Component;
}

/**
 * This function instantiates the given directives.
 */
function instantiateDirectivesDirectly() {
  const tNode = previousOrParentNode.tNode !;
  const size = (tNode.flags & TNodeFlags.SIZE_MASK) >> TNodeFlags.SIZE_SHIFT;

  if (size > 0) {
    const startIndex = tNode.flags >> TNodeFlags.INDX_SHIFT;
    const tDirectives = currentView.tView.directives !;

    for (let i = startIndex; i < startIndex + size; i++) {
      const def = tDirectives[i] as DirectiveDef<any>;
      directiveCreate(i, def.factory(), def);
    }
  }
}

/** Caches local names and their matching directive indices for query and template lookups. */
function cacheMatchingLocalNames(
    tNode: TNode, localRefs: string[] | null, exportsMap: {[key: string]: number}): void {
  if (localRefs) {
    const localNames: (string | number)[] = tNode.localNames = [];

    // Local names must be stored in tNode in the same order that localRefs are defined
    // in the template to ensure the data is loaded in the same slots as their refs
    // in the template (for template queries).
    for (let i = 0; i < localRefs.length; i += 2) {
      const index = exportsMap[localRefs[i + 1]];
      if (index == null) throw new Error(`Export of name '${localRefs[i + 1]}' not found!`);
      localNames.push(localRefs[i], index);
    }
  }
}

/**
 * Builds up an export map as directives are created, so local refs can be quickly mapped
 * to their directive instances.
 */
function saveNameToExportMap(
    index: number, def: DirectiveDef<any>| ComponentDef<any>,
    exportsMap: {[key: string]: number} | null) {
  if (exportsMap) {
    if (def.exportAs) exportsMap[def.exportAs] = index;
    if ((def as ComponentDef<any>).template) exportsMap[''] = index;
  }
}

/**
 * Takes a list of local names and indices and pushes the resolved local variable values
 * to data[] in the same order as they are loaded in the template with load().
 */
function saveResolvedLocalsInData(): void {
  const localNames = previousOrParentNode.tNode !.localNames;
  if (localNames) {
    for (let i = 0; i < localNames.length; i += 2) {
      const index = localNames[i + 1] as number;
      const value = index === -1 ? previousOrParentNode.native : directives ![index];
      data.push(value);
    }
  }
}

/**
 * Gets TView from a template function or creates a new TView
 * if it doesn't already exist.
 *
 * @param template The template from which to get static data
 * @param directives Directive defs that should be saved on TView
 * @param pipes Pipe defs that should be saved on TView
 * @returns TView
 */
function getOrCreateTView(
    template: ComponentTemplate<any>, directives: DirectiveDefListOrFactory | null,
    pipes: PipeDefListOrFactory | null): TView {
  return template.ngPrivateData ||
      (template.ngPrivateData = createTView(directives, pipes) as never);
}

/** Creates a TView instance */
export function createTView(
    defs: DirectiveDefListOrFactory | null, pipes: PipeDefListOrFactory | null): TView {
  return {
    data: [],
    directives: null,
    firstTemplatePass: true,
    initHooks: null,
    checkHooks: null,
    contentHooks: null,
    contentCheckHooks: null,
    viewHooks: null,
    viewCheckHooks: null,
    destroyHooks: null,
    pipeDestroyHooks: null,
    hostBindings: null,
    components: null,
    directiveRegistry: typeof defs === 'function' ? defs() : defs,
    pipeRegistry: typeof pipes === 'function' ? pipes() : pipes,
    currentMatches: null
  };
}

function setUpAttributes(native: RElement, attrs: string[]): void {
  ngDevMode && assertEqual(attrs.length % 2, 0, 'each attribute should have a key and a value');

  const isProc = isProceduralRenderer(renderer);
  for (let i = 0; i < attrs.length; i += 2) {
    const attrName = attrs[i];
    if (attrName !== NG_PROJECT_AS_ATTR_NAME) {
      const attrVal = attrs[i + 1];
      isProc ? (renderer as ProceduralRenderer3).setAttribute(native, attrName, attrVal) :
               native.setAttribute(attrName, attrVal);
    }
  }
}

export function createError(text: string, token: any) {
  return new Error(`Renderer: ${text} [${stringify(token)}]`);
}


/**
 * Locates the host native element, used for bootstrapping existing nodes into rendering pipeline.
 *
 * @param elementOrSelector Render element or CSS selector to locate the element.
 */
export function locateHostElement(
    factory: RendererFactory3, elementOrSelector: RElement | string): RElement|null {
  ngDevMode && assertDataInRange(-1);
  rendererFactory = factory;
  const defaultRenderer = factory.createRenderer(null, null);
  const rNode = typeof elementOrSelector === 'string' ?
      (isProceduralRenderer(defaultRenderer) ?
           defaultRenderer.selectRootElement(elementOrSelector) :
           defaultRenderer.querySelector(elementOrSelector)) :
      elementOrSelector;
  if (ngDevMode && !rNode) {
    if (typeof elementOrSelector === 'string') {
      throw createError('Host node with selector not found:', elementOrSelector);
    } else {
      throw createError('Host node is required:', elementOrSelector);
    }
  }
  return rNode;
}

/**
 * Creates the host LNode.
 *
 * @param rNode Render host element.
 * @param def ComponentDef
 *
 * @returns LElementNode created
 */
export function hostElement(
    tag: string, rNode: RElement | null, def: ComponentDef<any>): LElementNode {
  resetApplicationState();
  const node = createLNode(
      0, LNodeType.Element, rNode,
      createLView(
          -1, renderer, getOrCreateTView(def.template, def.directiveDefs, def.pipeDefs), null, null,
          def.onPush ? LViewFlags.Dirty : LViewFlags.CheckAlways));

  if (firstTemplatePass) {
    node.tNode = createTNode(tag as string, null, null);
    node.tNode.flags = TNodeFlags.Component;
    if (def.diPublic) def.diPublic(def);
    currentView.tView.directives = [def];
  }

  return node;
}


/**
 * Adds an event listener to the current node.
 *
 * If an output exists on one of the node's directives, it also subscribes to the output
 * and saves the subscription for later cleanup.
 *
 * @param eventName Name of the event
 * @param listenerFn The function to be called when event emits
 * @param useCapture Whether or not to use capture in event listener.
 */
export function listener(
    eventName: string, listenerFn: (e?: any) => any, useCapture = false): void {
  ngDevMode && assertPreviousIsParent();
  const node = previousOrParentNode;
  const native = node.native as RElement;

  // In order to match current behavior, native DOM event listeners must be added for all
  // events (including outputs).
  const cleanupFns = cleanup || (cleanup = currentView.cleanup = []);
  if (isProceduralRenderer(renderer)) {
    const wrappedListener = wrapListenerWithDirtyLogic(currentView, listenerFn);
    const cleanupFn = renderer.listen(native, eventName, wrappedListener);
    cleanupFns.push(cleanupFn, null);
  } else {
    const wrappedListener = wrapListenerWithDirtyAndDefault(currentView, listenerFn);
    native.addEventListener(eventName, wrappedListener, useCapture);
    cleanupFns.push(eventName, native, wrappedListener, useCapture);
  }

  let tNode: TNode|null = node.tNode !;
  if (tNode.outputs === undefined) {
    // if we create TNode here, inputs must be undefined so we know they still need to be
    // checked
    tNode.outputs = generatePropertyAliases(node.tNode !.flags, BindingDirection.Output);
  }

  const outputs = tNode.outputs;
  let outputData: PropertyAliasValue|undefined;
  if (outputs && (outputData = outputs[eventName])) {
    createOutput(outputData, listenerFn);
  }
}

/**
 * Iterates through the outputs associated with a particular event name and subscribes to
 * each output.
 */
function createOutput(outputs: PropertyAliasValue, listener: Function): void {
  for (let i = 0; i < outputs.length; i += 2) {
    ngDevMode && assertDataInRange(outputs[i] as number, directives !);
    const subscription = directives ![outputs[i] as number][outputs[i + 1]].subscribe(listener);
    cleanup !.push(subscription.unsubscribe, subscription);
  }
}

/** Mark the end of the element. */
export function elementEnd() {
  if (isParent) {
    isParent = false;
  } else {
    ngDevMode && assertHasParent();
    previousOrParentNode = previousOrParentNode.parent !;
  }
  ngDevMode && assertNodeType(previousOrParentNode, LNodeType.Element);
  const queries = previousOrParentNode.queries;
  queries && queries.addNode(previousOrParentNode);
  queueLifecycleHooks(previousOrParentNode.tNode !.flags, currentView);
}

/**
 * Updates the value of removes an attribute on an Element.
 *
 * @param number index The index of the element in the data array
 * @param name name The name of the attribute.
 * @param value value The attribute is removed when value is `null` or `undefined`.
 *                  Otherwise the attribute value is set to the stringified value.
 * @param sanitizer An optional function used to sanitize the value.
 */
export function elementAttribute(
    index: number, name: string, value: any, sanitizer?: Sanitizer): void {
  if (value !== NO_CHANGE) {
    const element: LElementNode = data[index];
    if (value == null) {
      isProceduralRenderer(renderer) ? renderer.removeAttribute(element.native, name) :
                                       element.native.removeAttribute(name);
    } else {
      const strValue = sanitizer == null ? stringify(value) : sanitizer(value);
      isProceduralRenderer(renderer) ? renderer.setAttribute(element.native, name, strValue) :
                                       element.native.setAttribute(name, strValue);
    }
  }
}

/**
 * Update a property on an Element.
 *
 * If the property name also exists as an input property on one of the element's directives,
 * the component property will be set instead of the element property. This check must
 * be conducted at runtime so child components that add new @Inputs don't have to be re-compiled.
 *
 * @param index The index of the element to update in the data array
 * @param propName Name of property. Because it is going to DOM, this is not subject to
 *        renaming as part of minification.
 * @param value New value to write.
 * @param sanitizer An optional function used to sanitize the value.
 */

export function elementProperty<T>(
    index: number, propName: string, value: T | NO_CHANGE, sanitizer?: Sanitizer): void {
  if (value === NO_CHANGE) return;
  const node = data[index] as LElementNode;
  const tNode = node.tNode !;
  // if tNode.inputs is undefined, a listener has created outputs, but inputs haven't
  // yet been checked
  if (tNode && tNode.inputs === undefined) {
    // mark inputs as checked
    tNode.inputs = generatePropertyAliases(node.tNode !.flags, BindingDirection.Input);
  }

  const inputData = tNode && tNode.inputs;
  let dataValue: PropertyAliasValue|undefined;
  if (inputData && (dataValue = inputData[propName])) {
    setInputsForProperty(dataValue, value);
    markDirtyIfOnPush(node);
  } else {
    // It is assumed that the sanitizer is only added when the compiler determines that the property
    // is risky, so sanitization can be done without further checks.
    value = sanitizer != null ? (sanitizer(value) as any) : value;
    const native = node.native;
    isProceduralRenderer(renderer) ? renderer.setProperty(native, propName, value) :
                                     (native.setProperty ? native.setProperty(propName, value) :
                                                           (native as any)[propName] = value);
  }
}

/**
 * Constructs a TNode object from the arguments.
 *
 * @param tagName
 * @param attrs
 * @param data
 * @param localNames A list of local names and their matching indices
 * @returns the TNode object
 */
function createTNode(
    tagName: string | null, attrs: string[] | null, data: TContainer | null): TNode {
  return {
    flags: 0,
    tagName: tagName,
    attrs: attrs,
    localNames: null,
    initialInputs: undefined,
    inputs: undefined,
    outputs: undefined,
    data: data
  };
}

/**
 * Given a list of directive indices and minified input names, sets the
 * input properties on the corresponding directives.
 */
function setInputsForProperty(inputs: PropertyAliasValue, value: any): void {
  for (let i = 0; i < inputs.length; i += 2) {
    ngDevMode && assertDataInRange(inputs[i] as number, directives !);
    directives ![inputs[i] as number][inputs[i + 1]] = value;
  }
}

/**
 * Consolidates all inputs or outputs of all directives on this logical node.
 *
 * @param number lNodeFlags logical node flags
 * @param Direction direction whether to consider inputs or outputs
 * @returns PropertyAliases|null aggregate of all properties if any, `null` otherwise
 */
function generatePropertyAliases(
    tNodeFlags: TNodeFlags, direction: BindingDirection): PropertyAliases|null {
  const size = (tNodeFlags & TNodeFlags.SIZE_MASK) >> TNodeFlags.SIZE_SHIFT;
  let propStore: PropertyAliases|null = null;

  if (size > 0) {
    const start = tNodeFlags >> TNodeFlags.INDX_SHIFT;
    const isInput = direction === BindingDirection.Input;
    const defs = currentView.tView.directives !;

    for (let i = start, ii = start + size; i < ii; i++) {
      const directiveDef = defs[i] as DirectiveDef<any>;
      const propertyAliasMap: {[publicName: string]: string} =
          isInput ? directiveDef.inputs : directiveDef.outputs;
      for (let publicName in propertyAliasMap) {
        if (propertyAliasMap.hasOwnProperty(publicName)) {
          propStore = propStore || {};
          const internalName = propertyAliasMap[publicName];
          const hasProperty = propStore.hasOwnProperty(publicName);
          hasProperty ? propStore[publicName].push(i, internalName) :
                        (propStore[publicName] = [i, internalName]);
        }
      }
    }
  }
  return propStore;
}

/**
 * Add or remove a class in a `classList` on a DOM element.
 *
 * This instruction is meant to handle the [class.foo]="exp" case
 *
 * @param index The index of the element to update in the data array
 * @param className Name of class to toggle. Because it is going to DOM, this is not subject to
 *        renaming as part of minification.
 * @param value A value indicating if a given class should be added or removed.
 */
export function elementClassNamed<T>(index: number, className: string, value: T | NO_CHANGE): void {
  if (value !== NO_CHANGE) {
    const lElement = data[index] as LElementNode;
    if (value) {
      isProceduralRenderer(renderer) ? renderer.addClass(lElement.native, className) :
                                       lElement.native.classList.add(className);

    } else {
      isProceduralRenderer(renderer) ? renderer.removeClass(lElement.native, className) :
                                       lElement.native.classList.remove(className);
    }
  }
}

/**
 * Set the `className` property on a DOM element.
 *
 * This instruction is meant to handle the `[class]="exp"` usage.
 *
 * `elementClass` instruction writes the value to the "element's" `className` property.
 *
 * @param index The index of the element to update in the data array
 * @param value A value indicating a set of classes which should be applied. The method overrides
 *   any existing classes. The value is stringified (`toString`) before it is applied to the
 *   element.
 */
export function elementClass<T>(index: number, value: T | NO_CHANGE): void {
  if (value !== NO_CHANGE) {
    // TODO: This is a naive implementation which simply writes value to the `className`. In the
    // future
    // we will add logic here which would work with the animation code.
    const lElement: LElementNode = data[index];
    isProceduralRenderer(renderer) ? renderer.setProperty(lElement.native, 'className', value) :
                                     lElement.native['className'] = stringify(value);
  }
}

/**
 * Update a given style on an Element.
 *
 * @param index Index of the element to change in the data array
 * @param styleName Name of property. Because it is going to DOM this is not subject to
 *        renaming as part of minification.
 * @param value New value to write (null to remove).
 * @param suffix Optional suffix. Used with scalar values to add unit such as `px`.
 * @param sanitizer An optional function used to transform the value typically used for
 *        sanitization.
 */
export function elementStyleNamed<T>(
    index: number, styleName: string, value: T | NO_CHANGE, suffix?: string): void;
export function elementStyleNamed<T>(
    index: number, styleName: string, value: T | NO_CHANGE, sanitizer?: Sanitizer): void;
export function elementStyleNamed<T>(
    index: number, styleName: string, value: T | NO_CHANGE,
    suffixOrSanitizer?: string | Sanitizer): void {
  if (value !== NO_CHANGE) {
    const lElement: LElementNode = data[index];
    if (value == null) {
      isProceduralRenderer(renderer) ?
          renderer.removeStyle(lElement.native, styleName, RendererStyleFlags3.DashCase) :
          lElement.native['style'].removeProperty(styleName);
    } else {
      let strValue =
          typeof suffixOrSanitizer == 'function' ? suffixOrSanitizer(value) : stringify(value);
      if (typeof suffixOrSanitizer == 'string') strValue = strValue + suffixOrSanitizer;
      isProceduralRenderer(renderer) ?
          renderer.setStyle(lElement.native, styleName, strValue, RendererStyleFlags3.DashCase) :
          lElement.native['style'].setProperty(styleName, strValue);
    }
  }
}

/**
 * Set the `style` property on a DOM element.
 *
 * This instruction is meant to handle the `[style]="exp"` usage.
 *
 *
 * @param index The index of the element to update in the data array
 * @param value A value indicating if a given style should be added or removed.
 *   The expected shape of `value` is an object where keys are style names and the values
 *   are their corresponding values to set. If value is falsy than the style is remove. An absence
 *   of style does not cause that style to be removed. `NO_CHANGE` implies that no update should be
 *   performed.
 */
export function elementStyle<T>(
    index: number, value: {[styleName: string]: any} | NO_CHANGE): void {
  if (value !== NO_CHANGE) {
    // TODO: This is a naive implementation which simply writes value to the `style`. In the future
    // we will add logic here which would work with the animation code.
    const lElement = data[index] as LElementNode;
    if (isProceduralRenderer(renderer)) {
      renderer.setProperty(lElement.native, 'style', value);
    } else {
      const style = lElement.native['style'];
      for (let i = 0, keys = Object.keys(value); i < keys.length; i++) {
        const styleName: string = keys[i];
        const styleValue: any = (value as any)[styleName];
        styleValue == null ? style.removeProperty(styleName) :
                             style.setProperty(styleName, styleValue);
      }
    }
  }
}



//////////////////////////
//// Text
//////////////////////////

/**
 * Create static text node
 *
 * @param index Index of the node in the data array.
 * @param value Value to write. This value will be stringified.
 *   If value is not provided than the actual creation of the text node is delayed.
 */
export function text(index: number, value?: any): void {
  ngDevMode &&
      assertEqual(
          currentView.bindingStartIndex, -1, 'text nodes should be created before bindings');
  const textNode = value != null ? createTextNode(value, renderer) : null;
  const node = createLNode(index, LNodeType.Element, textNode);
  // Text nodes are self closing.
  isParent = false;
  appendChild(node.parent !, textNode, currentView);
}

/**
 * Create text node with binding
 * Bindings should be handled externally with the proper bind(1-8) method
 *
 * @param index Index of the node in the data array.
 * @param value Stringified value to write.
 */
export function textBinding<T>(index: number, value: T | NO_CHANGE): void {
  ngDevMode && assertDataInRange(index);
  let existingNode = data[index] as LTextNode;
  ngDevMode && assertNotNull(existingNode, 'existing node');
  if (existingNode.native) {
    // If DOM node exists and value changed, update textContent
    value !== NO_CHANGE &&
        (isProceduralRenderer(renderer) ? renderer.setValue(existingNode.native, stringify(value)) :
                                          existingNode.native.textContent = stringify(value));
  } else {
    // Node was created but DOM node creation was delayed. Create and append now.
    existingNode.native = createTextNode(value, renderer);
    insertChild(existingNode, currentView);
  }
}

//////////////////////////
//// Directive
//////////////////////////

/**
 * Create a directive.
 *
 * NOTE: directives can be created in order other than the index order. They can also
 *       be retrieved before they are created in which case the value will be null.
 *
 * @param directive The directive instance.
 * @param directiveDef DirectiveDef object which contains information about the template.
 */
export function directiveCreate<T>(
    index: number, directive: T, directiveDef: DirectiveDef<T>| ComponentDef<T>): T {
  const instance = baseDirectiveCreate(index, directive, directiveDef);

  ngDevMode && assertNotNull(previousOrParentNode.tNode, 'previousOrParentNode.tNode');
  const tNode: TNode|null = previousOrParentNode.tNode !;

  const isComponent = (directiveDef as ComponentDef<T>).template;
  if (isComponent) {
    addComponentLogic(index, directive, directiveDef as ComponentDef<T>);
  }

  if (firstTemplatePass) {
    // Init hooks are queued now so ngOnInit is called in host components before
    // any projected components.
    queueInitHooks(index, directiveDef.onInit, directiveDef.doCheck, currentView.tView);

    if (directiveDef.hostBindings) queueHostBindingForCheck(index);
  }

  if (tNode && tNode.attrs) {
    setInputsFromAttrs(index, instance, directiveDef.inputs, tNode);
  }

  return instance;
}

function addComponentLogic<T>(index: number, instance: T, def: ComponentDef<T>): void {
  const tView = getOrCreateTView(def.template, def.directiveDefs, def.pipeDefs);

  // Only component views should be added to the view tree directly. Embedded views are
  // accessed through their containers because they may be removed / re-added later.
  const hostView = addToViewTree(
      currentView, createLView(
                       -1, rendererFactory.createRenderer(
                               previousOrParentNode.native as RElement, def.rendererType),
                       tView, null, null, def.onPush ? LViewFlags.Dirty : LViewFlags.CheckAlways));

  (previousOrParentNode.data as any) = hostView;
  (hostView.node as any) = previousOrParentNode;

  initChangeDetectorIfExisting(previousOrParentNode.nodeInjector, instance, hostView);

  if (firstTemplatePass) queueComponentIndexForCheck(index);
}

/**
 * A lighter version of directiveCreate() that is used for the root component
 *
 * This version does not contain features that we don't already support at root in
 * current Angular. Example: local refs and inputs on root component.
 */
export function baseDirectiveCreate<T>(
    index: number, directive: T, directiveDef: DirectiveDef<T>| ComponentDef<T>): T {
  ngDevMode &&
      assertEqual(
          currentView.bindingStartIndex, -1, 'directives should be created before any bindings');
  ngDevMode && assertPreviousIsParent();

  Object.defineProperty(
      directive, NG_HOST_SYMBOL, {enumerable: false, value: previousOrParentNode});

  if (directives == null) currentView.directives = directives = [];

  ngDevMode && assertDataNext(index, directives);
  directives[index] = directive;

  if (firstTemplatePass) {
    const flags = previousOrParentNode.tNode !.flags;
    previousOrParentNode.tNode !.flags = (flags & TNodeFlags.SIZE_MASK) === 0 ?
        (index << TNodeFlags.INDX_SHIFT) | TNodeFlags.SIZE_SKIP | flags & TNodeFlags.Component :
        flags + TNodeFlags.SIZE_SKIP;
  } else {
    const diPublic = directiveDef !.diPublic;
    if (diPublic) diPublic(directiveDef !);
  }

  if (directiveDef !.attributes != null && previousOrParentNode.type == LNodeType.Element) {
    setUpAttributes(
        (previousOrParentNode as LElementNode).native, directiveDef !.attributes as string[]);
  }

  return directive;
}

/**
 * Sets initial input properties on directive instances from attribute data
 *
 * @param directiveIndex Index of the directive in directives array
 * @param instance Instance of the directive on which to set the initial inputs
 * @param inputs The list of inputs from the directive def
 * @param tNode The static data for this node
 */
function setInputsFromAttrs<T>(
    directiveIndex: number, instance: T, inputs: {[key: string]: string}, tNode: TNode): void {
  let initialInputData = tNode.initialInputs as InitialInputData | undefined;
  if (initialInputData === undefined || directiveIndex >= initialInputData.length) {
    initialInputData = generateInitialInputs(directiveIndex, inputs, tNode);
  }

  const initialInputs: InitialInputs|null = initialInputData[directiveIndex];
  if (initialInputs) {
    for (let i = 0; i < initialInputs.length; i += 2) {
      (instance as any)[initialInputs[i]] = initialInputs[i + 1];
    }
  }
}

/**
 * Generates initialInputData for a node and stores it in the template's static storage
 * so subsequent template invocations don't have to recalculate it.
 *
 * initialInputData is an array containing values that need to be set as input properties
 * for directives on this node, but only once on creation. We need this array to support
 * the case where you set an @Input property of a directive using attribute-like syntax.
 * e.g. if you have a `name` @Input, you can set it once like this:
 *
 * <my-component name="Bess"></my-component>
 *
 * @param directiveIndex Index to store the initial input data
 * @param inputs The list of inputs from the directive def
 * @param tNode The static data on this node
 */
function generateInitialInputs(
    directiveIndex: number, inputs: {[key: string]: string}, tNode: TNode): InitialInputData {
  const initialInputData: InitialInputData = tNode.initialInputs || (tNode.initialInputs = []);
  initialInputData[directiveIndex] = null;

  const attrs = tNode.attrs !;
  for (let i = 0; i < attrs.length; i += 2) {
    const attrName = attrs[i];
    const minifiedInputName = inputs[attrName];
    if (minifiedInputName !== undefined) {
      const inputsToStore: InitialInputs =
          initialInputData[directiveIndex] || (initialInputData[directiveIndex] = []);
      inputsToStore.push(minifiedInputName, attrs[i + 1]);
    }
  }
  return initialInputData;
}


//////////////////////////
//// ViewContainer & View
//////////////////////////


export function createLContainer(
    parentLNode: LNode, currentView: LView, template?: ComponentTemplate<any>): LContainer {
  ngDevMode && assertNotNull(parentLNode, 'containers should have a parent');
  return <LContainer>{
    views: [],
    nextIndex: 0,
    // If the direct parent of the container is a view, its views will need to be added
    // through insertView() when its parent view is being inserted:
    renderParent: canInsertNativeNode(parentLNode, currentView) ? parentLNode : null,
    template: template == null ? null : template,
    next: null,
    parent: currentView,
    dynamicViewCount: 0,
    queries: null
  };
}

/**
 * Creates an LContainerNode.
 *
 * Only `LViewNodes` can go into `LContainerNodes`.
 *
 * @param index The index of the container in the data array
 * @param template Optional inline template
 * @param tagName The name of the container element, if applicable
 * @param attrs The attrs attached to the container, if applicable
 * @param localRefs A set of local reference bindings on the element.
 */
export function container(
    index: number, template?: ComponentTemplate<any>, tagName?: string, attrs?: string[],
    localRefs?: string[] | null): void {
  ngDevMode && assertEqual(
                   currentView.bindingStartIndex, -1,
                   'container nodes should be created before any bindings');

  const currentParent = isParent ? previousOrParentNode : previousOrParentNode.parent !;
  const lContainer = createLContainer(currentParent, currentView, template);

  const node = createLNode(index, LNodeType.Container, undefined, lContainer);

  // Containers are added to the current view tree instead of their embedded views
  // because views can be removed and re-inserted.
  addToViewTree(currentView, node.data);
  createDirectivesAndLocals(index, tagName || null, attrs, localRefs, []);

  isParent = false;
  ngDevMode && assertNodeType(previousOrParentNode, LNodeType.Container);
  const queries = node.queries;
  if (queries) {
    // check if a given container node matches
    queries.addNode(node);
    // prepare place for matching nodes from views inserted into a given container
    lContainer.queries = queries.container();
  }
}

/**
 * Sets a container up to receive views.
 *
 * @param index The index of the container in the data array
 */
export function containerRefreshStart(index: number): void {
  ngDevMode && assertDataInRange(index);
  previousOrParentNode = data[index] as LNode;
  ngDevMode && assertNodeType(previousOrParentNode, LNodeType.Container);
  isParent = true;
  (previousOrParentNode as LContainerNode).data.nextIndex = 0;
  ngDevMode && assertSame(
                   (previousOrParentNode as LContainerNode).native, undefined,
                   `the container's native element should not have been set yet.`);

  if (!checkNoChangesMode) {
    // We need to execute init hooks here so ngOnInit hooks are called in top level views
    // before they are called in embedded views (for backwards compatibility).
    executeInitHooks(currentView, currentView.tView, creationMode);
  }
}

/**
 * Marks the end of the LContainerNode.
 *
 * Marking the end of LContainerNode is the time when to child Views get inserted or removed.
 */
export function containerRefreshEnd(): void {
  if (isParent) {
    isParent = false;
  } else {
    ngDevMode && assertNodeType(previousOrParentNode, LNodeType.View);
    ngDevMode && assertHasParent();
    previousOrParentNode = previousOrParentNode.parent !;
  }
  ngDevMode && assertNodeType(previousOrParentNode, LNodeType.Container);
  const container = previousOrParentNode as LContainerNode;
  container.native = undefined;
  ngDevMode && assertNodeType(container, LNodeType.Container);
  const nextIndex = container.data.nextIndex;

  // remove extra views at the end of the container
  while (nextIndex < container.data.views.length) {
    removeView(container, nextIndex);
  }
}

function refreshDynamicChildren() {
  for (let current = currentView.child; current !== null; current = current.next) {
    if (current.dynamicViewCount !== 0 && (current as LContainer).views) {
      const container = current as LContainer;
      for (let i = 0; i < container.views.length; i++) {
        const view = container.views[i];
        renderEmbeddedTemplate(view, view.data.template !, view.data.context !, renderer);
      }
    }
  }
}

/**
 * Looks for a view with a given view block id inside a provided LContainer.
 * Removes views that need to be deleted in the process.
 *
 * @param containerNode where to search for views
 * @param startIdx starting index in the views array to search from
 * @param viewBlockId exact view block id to look for
 * @returns index of a found view or -1 if not found
 */
function scanForView(
    containerNode: LContainerNode, startIdx: number, viewBlockId: number): LViewNode|null {
  const views = containerNode.data.views;
  for (let i = startIdx; i < views.length; i++) {
    const viewAtPositionId = views[i].data.id;
    if (viewAtPositionId === viewBlockId) {
      return views[i];
    } else if (viewAtPositionId < viewBlockId) {
      // found a view that should not be at this position - remove
      removeView(containerNode, i);
    } else {
      // found a view with id grater than the one we are searching for
      // which means that required view doesn't exist and can't be found at
      // later positions in the views array - stop the search here
      break;
    }
  }
  return null;
}

/**
 * Marks the start of an embedded view.
 *
 * @param viewBlockId The ID of this view
 * @return boolean Whether or not this view is in creation mode
 */
export function embeddedViewStart(viewBlockId: number): RenderFlags {
  const container =
      (isParent ? previousOrParentNode : previousOrParentNode.parent !) as LContainerNode;
  ngDevMode && assertNodeType(container, LNodeType.Container);
  const lContainer = container.data;
  let viewNode: LViewNode|null = scanForView(container, lContainer.nextIndex, viewBlockId);

  if (viewNode) {
    previousOrParentNode = viewNode;
    ngDevMode && assertNodeType(previousOrParentNode, LNodeType.View);
    isParent = true;
    enterView(viewNode.data, viewNode);
  } else {
    // When we create a new LView, we always reset the state of the instructions.
    const newView = createLView(
        viewBlockId, renderer, getOrCreateEmbeddedTView(viewBlockId, container), null, null,
        LViewFlags.CheckAlways);
    if (lContainer.queries) {
      newView.queries = lContainer.queries.enterView(lContainer.nextIndex);
    }

    enterView(newView, viewNode = createLNode(null, LNodeType.View, null, newView));
  }
  return getRenderFlags(viewNode.data);
}

/**
 * Initialize the TView (e.g. static data) for the active embedded view.
 *
 * Each embedded view needs to set the global tData variable to the static data for
 * that view. Otherwise, the view's static data for a particular node would overwrite
 * the static data for a node in the view above it with the same index (since it's in the
 * same template).
 *
 * @param viewIndex The index of the TView in TContainer
 * @param parent The parent container in which to look for the view's static data
 * @returns TView
 */
function getOrCreateEmbeddedTView(viewIndex: number, parent: LContainerNode): TView {
  ngDevMode && assertNodeType(parent, LNodeType.Container);
  const tContainer = (parent !.tNode as TContainerNode).data;
  if (viewIndex >= tContainer.length || tContainer[viewIndex] == null) {
    const tView = currentView.tView;
    tContainer[viewIndex] = createTView(tView.directiveRegistry, tView.pipeRegistry);
  }
  return tContainer[viewIndex];
}

/** Marks the end of an embedded view. */
export function embeddedViewEnd(): void {
  refreshDirectives();
  isParent = false;
  const viewNode = previousOrParentNode = currentView.node as LViewNode;
  const containerNode = previousOrParentNode.parent as LContainerNode;
  if (containerNode) {
    ngDevMode && assertNodeType(viewNode, LNodeType.View);
    ngDevMode && assertNodeType(containerNode, LNodeType.Container);
    const lContainer = containerNode.data;

    if (creationMode) {
      // When projected nodes are going to be inserted, the renderParent of the dynamic container
      // used by the ViewContainerRef must be set.
      setRenderParentInProjectedNodes(lContainer.renderParent, viewNode);
      // it is a new view, insert it into collection of views for a given container
      insertView(containerNode, viewNode, lContainer.nextIndex);
    }

    lContainer.nextIndex++;
  }
  leaveView(currentView !.parent !);
  ngDevMode && assertEqual(isParent, false, 'isParent');
  ngDevMode && assertNodeType(previousOrParentNode, LNodeType.View);
}

/**
 * For nodes which are projected inside an embedded view, this function sets the renderParent
 * of their dynamic LContainerNode.
 * @param renderParent the renderParent of the LContainer which contains the embedded view.
 * @param viewNode the embedded view.
 */
function setRenderParentInProjectedNodes(
    renderParent: LElementNode | null, viewNode: LViewNode): void {
  if (renderParent != null) {
    let node = viewNode.child;
    while (node) {
      if (node.type === LNodeType.Projection) {
        let nodeToProject: LNode|null = (node as LProjectionNode).data.head;
        const lastNodeToProject = (node as LProjectionNode).data.tail;
        while (nodeToProject) {
          if (nodeToProject.dynamicLContainerNode) {
            nodeToProject.dynamicLContainerNode.data.renderParent = renderParent;
          }
          nodeToProject = nodeToProject === lastNodeToProject ? null : nodeToProject.pNextOrParent;
        }
      }
      node = node.next;
    }
  }
}

/////////////

/**
 * Refreshes components by entering the component view and processing its bindings, queries, etc.
 *
 * @param directiveIndex
 * @param elementIndex
 */
export function componentRefresh<T>(directiveIndex: number, elementIndex: number): void {
  ngDevMode && assertDataInRange(elementIndex);
  const element = data ![elementIndex] as LElementNode;
  ngDevMode && assertNodeType(element, LNodeType.Element);
  ngDevMode && assertNotNull(element.data, `Component's host node should have an LView attached.`);
  const hostView = element.data !;

  // Only attached CheckAlways components or attached, dirty OnPush components should be checked
  if (viewAttached(hostView) && hostView.flags & (LViewFlags.CheckAlways | LViewFlags.Dirty)) {
    ngDevMode && assertDataInRange(directiveIndex, directives !);
    const def = currentView.tView.directives ![directiveIndex] as ComponentDef<T>;

    detectChangesInternal(
        hostView, element, def, getDirectiveInstance(directives ![directiveIndex]));
  }
}

/** Returns a boolean for whether the view is attached */
function viewAttached(view: LView): boolean {
  return (view.flags & LViewFlags.Attached) === LViewFlags.Attached;
}

/**
 * Instruction to distribute projectable nodes among <ng-content> occurrences in a given template.
 * It takes all the selectors from the entire component's template and decides where
 * each projected node belongs (it re-distributes nodes among "buckets" where each "bucket" is
 * backed by a selector).
 *
 * This function requires CSS selectors to be provided in 2 forms: parsed (by a compiler) and text,
 * un-parsed form.
 *
 * The parsed form is needed for efficient matching of a node against a given CSS selector.
 * The un-parsed, textual form is needed for support of the ngProjectAs attribute.
 *
 * Having a CSS selector in 2 different formats is not ideal, but alternatives have even more
 * drawbacks:
 * - having only a textual form would require runtime parsing of CSS selectors;
 * - we can't have only a parsed as we can't re-construct textual form from it (as entered by a
 * template author).
 *
 * @param selectors A collection of parsed CSS selectors
 * @param rawSelectors A collection of CSS selectors in the raw, un-parsed form
 */
export function projectionDef(
    index: number, selectors?: CssSelectorList[], textSelectors?: string[]): void {
  const noOfNodeBuckets = selectors ? selectors.length + 1 : 1;
  const distributedNodes = new Array<LNode[]>(noOfNodeBuckets);
  for (let i = 0; i < noOfNodeBuckets; i++) {
    distributedNodes[i] = [];
  }

  const componentNode = findComponentHost(currentView);
  let componentChild = componentNode.child;

  while (componentChild !== null) {
    // execute selector matching logic if and only if:
    // - there are selectors defined
    // - a node has a tag name / attributes that can be matched
    if (selectors && componentChild.tNode) {
      const matchedIdx = matchingSelectorIndex(componentChild.tNode, selectors, textSelectors !);
      distributedNodes[matchedIdx].push(componentChild);
    } else {
      distributedNodes[0].push(componentChild);
    }

    componentChild = componentChild.next;
  }

  ngDevMode && assertDataNext(index);
  data[index] = distributedNodes;
}

/**
 * Updates the linked list of a projection node, by appending another linked list.
 *
 * @param projectionNode Projection node whose projected nodes linked list has to be updated
 * @param appendedFirst First node of the linked list to append.
 * @param appendedLast Last node of the linked list to append.
 */
function appendToProjectionNode(
    projectionNode: LProjectionNode,
    appendedFirst: LElementNode | LTextNode | LContainerNode | null,
    appendedLast: LElementNode | LTextNode | LContainerNode | null) {
  ngDevMode && assertEqual(
                   !!appendedFirst, !!appendedLast,
                   'appendedFirst can be null if and only if appendedLast is also null');
  if (!appendedLast) {
    // nothing to append
    return;
  }
  const projectionNodeData = projectionNode.data;
  if (projectionNodeData.tail) {
    projectionNodeData.tail.pNextOrParent = appendedFirst;
  } else {
    projectionNodeData.head = appendedFirst;
  }
  projectionNodeData.tail = appendedLast;
  appendedLast.pNextOrParent = projectionNode;
}

/**
 * Inserts previously re-distributed projected nodes. This instruction must be preceded by a call
 * to the projectionDef instruction.
 *
 * @param nodeIndex
 * @param localIndex - index under which distribution of projected nodes was memorized
 * @param selectorIndex - 0 means <ng-content> without any selector
 * @param attrs - attributes attached to the ng-content node, if present
 */
export function projection(
    nodeIndex: number, localIndex: number, selectorIndex: number = 0, attrs?: string[]): void {
  const node = createLNode(nodeIndex, LNodeType.Projection, null, {head: null, tail: null});

  if (node.tNode == null) {
    node.tNode = createTNode(null, attrs || null, null);
  }

  isParent = false;  // self closing
  const currentParent = node.parent;

  // re-distribution of projectable nodes is memorized on a component's view level
  const componentNode = findComponentHost(currentView);

  // make sure that nodes to project were memorized
  const nodesForSelector = componentNode.data !.data ![localIndex][selectorIndex];

  // build the linked list of projected nodes:
  for (let i = 0; i < nodesForSelector.length; i++) {
    const nodeToProject = nodesForSelector[i];
    if (nodeToProject.type === LNodeType.Projection) {
      const previouslyProjected = (nodeToProject as LProjectionNode).data;
      appendToProjectionNode(node, previouslyProjected.head, previouslyProjected.tail);
    } else {
      appendToProjectionNode(
          node, nodeToProject as LTextNode | LElementNode | LContainerNode,
          nodeToProject as LTextNode | LElementNode | LContainerNode);
    }
  }

  if (canInsertNativeNode(currentParent, currentView)) {
    ngDevMode && assertNodeType(currentParent, LNodeType.Element);
    // process each node in the list of projected nodes:
    let nodeToProject: LNode|null = node.data.head;
    const lastNodeToProject = node.data.tail;
    while (nodeToProject) {
      appendProjectedNode(
          nodeToProject as LTextNode | LElementNode | LContainerNode, currentParent as LElementNode,
          currentView);
      nodeToProject = nodeToProject === lastNodeToProject ? null : nodeToProject.pNextOrParent;
    }
  }
}

/**
 * Given a current view, finds the nearest component's host (LElement).
 *
 * @param lView LView for which we want a host element node
 * @returns The host node
 */
function findComponentHost(lView: LView): LElementNode {
  let viewRootLNode = lView.node;
  while (viewRootLNode.type === LNodeType.View) {
    ngDevMode && assertNotNull(lView.parent, 'lView.parent');
    lView = lView.parent !;
    viewRootLNode = lView.node;
  }

  ngDevMode && assertNodeType(viewRootLNode, LNodeType.Element);
  ngDevMode && assertNotNull(viewRootLNode.data, 'node.data');

  return viewRootLNode as LElementNode;
}

/**
 * Adds a LView or a LContainer to the end of the current view tree.
 *
 * This structure will be used to traverse through nested views to remove listeners
 * and call onDestroy callbacks.
 *
 * @param currentView The view where LView or LContainer should be added
 * @param state The LView or LContainer to add to the view tree
 * @returns The state passed in
 */
export function addToViewTree<T extends LView|LContainer>(currentView: LView, state: T): T {
  currentView.tail ? (currentView.tail.next = state) : (currentView.child = state);
  currentView.tail = state;
  return state;
}

///////////////////////////////
//// Change detection
///////////////////////////////

/** If node is an OnPush component, marks its LView dirty. */
export function markDirtyIfOnPush(node: LElementNode): void {
  // Because data flows down the component tree, ancestors do not need to be marked dirty
  if (node.data && !(node.data.flags & LViewFlags.CheckAlways)) {
    node.data.flags |= LViewFlags.Dirty;
  }
}

/**
 * Wraps an event listener so its host view and its ancestor views will be marked dirty
 * whenever the event fires. Necessary to support OnPush components.
 */
export function wrapListenerWithDirtyLogic(view: LView, listenerFn: (e?: any) => any): (e: Event) =>
    any {
  return function(e: any) {
    markViewDirty(view);
    return listenerFn(e);
  };
}

/**
 * Wraps an event listener so its host view and its ancestor views will be marked dirty
 * whenever the event fires. Also wraps with preventDefault behavior.
 */
export function wrapListenerWithDirtyAndDefault(
    view: LView, listenerFn: (e?: any) => any): EventListener {
  return function wrapListenerIn_markViewDirty(e: Event) {
    markViewDirty(view);
    if (listenerFn(e) === false) {
      e.preventDefault();
      // Necessary for legacy browsers that don't support preventDefault (e.g. IE)
      e.returnValue = false;
    }
  };
}

/** Marks current view and all ancestors dirty */
export function markViewDirty(view: LView): void {
  let currentView: LView|null = view;

  while (currentView.parent != null) {
    currentView.flags |= LViewFlags.Dirty;
    currentView = currentView.parent;
  }
  currentView.flags |= LViewFlags.Dirty;

  ngDevMode && assertNotNull(currentView !.context, 'rootContext');
  scheduleTick(currentView !.context as RootContext);
}


/**
 * Used to schedule change detection on the whole application.
 *
 * Unlike `tick`, `scheduleTick` coalesces multiple calls into one change detection run.
 * It is usually called indirectly by calling `markDirty` when the view needs to be
 * re-rendered.
 *
 * Typically `scheduleTick` uses `requestAnimationFrame` to coalesce multiple
 * `scheduleTick` requests. The scheduling function can be overridden in
 * `renderComponent`'s `scheduler` option.
 */
export function scheduleTick<T>(rootContext: RootContext) {
  if (rootContext.clean == _CLEAN_PROMISE) {
    let res: null|((val: null) => void);
    rootContext.clean = new Promise<null>((r) => res = r);
    rootContext.scheduler(() => {
      tick(rootContext.component);
      res !(null);
      rootContext.clean = _CLEAN_PROMISE;
    });
  }
}

/**
 * Used to perform change detection on the whole application.
 *
 * This is equivalent to `detectChanges`, but invoked on root component. Additionally, `tick`
 * executes lifecycle hooks and conditionally checks components based on their
 * `ChangeDetectionStrategy` and dirtiness.
 *
 * The preferred way to trigger change detection is to call `markDirty`. `markDirty` internally
 * schedules `tick` using a scheduler in order to coalesce multiple `markDirty` calls into a
 * single change detection run. By default, the scheduler is `requestAnimationFrame`, but can
 * be changed when calling `renderComponent` and providing the `scheduler` option.
 */
export function tick<T>(component: T): void {
  const rootView = getRootView(component);
  const rootComponent = (rootView.context as RootContext).component;
  const hostNode = _getComponentHostLElementNode(rootComponent);

  ngDevMode && assertNotNull(hostNode.data, 'Component host node should be attached to an LView');
  renderComponentOrTemplate(hostNode, rootView, rootComponent);
}

/**
 * Retrieve the root view from any component by walking the parent `LView` until
 * reaching the root `LView`.
 *
 * @param component any component
 */

export function getRootView(component: any): LView {
  ngDevMode && assertNotNull(component, 'component');
  const lElementNode = _getComponentHostLElementNode(component);
  let lView = lElementNode.view;
  while (lView.parent) {
    lView = lView.parent;
  }
  return lView;
}

/**
 * Synchronously perform change detection on a component (and possibly its sub-components).
 *
 * This function triggers change detection in a synchronous way on a component. There should
 * be very little reason to call this function directly since a preferred way to do change
 * detection is to {@link markDirty} the component and wait for the scheduler to call this method
 * at some future point in time. This is because a single user action often results in many
 * components being invalidated and calling change detection on each component synchronously
 * would be inefficient. It is better to wait until all components are marked as dirty and
 * then perform single change detection across all of the components
 *
 * @param component The component which the change detection should be performed on.
 */
export function detectChanges<T>(component: T): void {
  const hostNode = _getComponentHostLElementNode(component);
  ngDevMode && assertNotNull(hostNode.data, 'Component host node should be attached to an LView');
  const componentIndex = hostNode.tNode !.flags >> TNodeFlags.INDX_SHIFT;
  const def = hostNode.view.tView.directives ![componentIndex] as ComponentDef<T>;
  detectChangesInternal(hostNode.data as LView, hostNode, def, component);
}


/**
 * Checks the change detector and its children, and throws if any changes are detected.
 *
 * This is used in development mode to verify that running change detection doesn't
 * introduce other changes.
 */
export function checkNoChanges<T>(component: T): void {
  checkNoChangesMode = true;
  try {
    detectChanges(component);
  } finally {
    checkNoChangesMode = false;
  }
}

/** Checks the view of the component provided. Does not gate on dirty checks or execute doCheck. */
export function detectChangesInternal<T>(
    hostView: LView, hostNode: LElementNode, def: ComponentDef<T>, component: T) {
  const oldView = enterView(hostView, hostNode);
  const template = def.template;

  try {
    template(getRenderFlags(hostView), component);
    refreshDirectives();
    refreshDynamicChildren();
  } finally {
    leaveView(oldView);
  }
}


/**
 * Mark the component as dirty (needing change detection).
 *
 * Marking a component dirty will schedule a change detection on this
 * component at some point in the future. Marking an already dirty
 * component as dirty is a noop. Only one outstanding change detection
 * can be scheduled per component tree. (Two components bootstrapped with
 * separate `renderComponent` will have separate schedulers)
 *
 * When the root component is bootstrapped with `renderComponent`, a scheduler
 * can be provided.
 *
 * @param component Component to mark as dirty.
 */
export function markDirty<T>(component: T) {
  ngDevMode && assertNotNull(component, 'component');
  const lElementNode = _getComponentHostLElementNode(component);
  markViewDirty(lElementNode.view);
}

///////////////////////////////
//// Bindings & interpolations
///////////////////////////////

export interface NO_CHANGE {
  // This is a brand that ensures that this type can never match anything else
  brand: 'NO_CHANGE';
}

/** A special value which designates that a value has not changed. */
export const NO_CHANGE = {} as NO_CHANGE;

/**
 *  Initializes the binding start index. Will get inlined.
 *
 *  This function must be called before any binding related function is called
 *  (ie `bind()`, `interpolationX()`, `pureFunctionX()`)
 */
function initBindings() {
  ngDevMode && assertEqual(
                   currentView.bindingStartIndex, -1,
                   'Binding start index should only be set once, when null');
  ngDevMode && assertEqual(
                   currentView.bindingIndex, -1,
                   'Binding index should not yet be set ' + currentView.bindingIndex);
  currentView.bindingIndex = currentView.bindingStartIndex = data.length;
}

/**
 * Creates a single value binding.
 *
 * @param value Value to diff
 */
export function bind<T>(value: T | NO_CHANGE): T|NO_CHANGE {
  if (currentView.bindingStartIndex < 0) {
    initBindings();
    return data[currentView.bindingIndex++] = value;
  }

  const changed: boolean =
      value !== NO_CHANGE && isDifferent(data[currentView.bindingIndex], value);
  if (changed) {
    throwErrorIfNoChangesMode(
        creationMode, checkNoChangesMode, data[currentView.bindingIndex], value);
    data[currentView.bindingIndex] = value;
  }
  currentView.bindingIndex++;
  return changed ? value : NO_CHANGE;
}

/**
 * Create interpolation bindings with a variable number of expressions.
 *
 * If there are 1 to 8 expressions `interpolation1()` to `interpolation8()` should be used instead.
 * Those are faster because there is no need to create an array of expressions and iterate over it.
 *
 * `values`:
 * - has static text at even indexes,
 * - has evaluated expressions at odd indexes.
 *
 * Returns the concatenated string when any of the arguments changes, `NO_CHANGE` otherwise.
 */
export function interpolationV(values: any[]): string|NO_CHANGE {
  ngDevMode && assertLessThan(2, values.length, 'should have at least 3 values');
  ngDevMode && assertEqual(values.length % 2, 1, 'should have an odd number of values');

  let different = false;

  for (let i = 1; i < values.length; i += 2) {
    // Check if bindings (odd indexes) have changed
    bindingUpdated(values[i]) && (different = true);
  }

  if (!different) {
    return NO_CHANGE;
  }

  // Build the updated content
  let content = values[0];
  for (let i = 1; i < values.length; i += 2) {
    content += stringify(values[i]) + values[i + 1];
  }

  return content;
}

/**
 * Creates an interpolation binding with 1 expression.
 *
 * @param prefix static value used for concatenation only.
 * @param v0 value checked for change.
 * @param suffix static value used for concatenation only.
 */
export function interpolation1(prefix: string, v0: any, suffix: string): string|NO_CHANGE {
  const different = bindingUpdated(v0);

  return different ? prefix + stringify(v0) + suffix : NO_CHANGE;
}

/** Creates an interpolation binding with 2 expressions. */
export function interpolation2(
    prefix: string, v0: any, i0: string, v1: any, suffix: string): string|NO_CHANGE {
  const different = bindingUpdated2(v0, v1);

  return different ? prefix + stringify(v0) + i0 + stringify(v1) + suffix : NO_CHANGE;
}

/** Creates an interpolation bindings with 3 expressions. */
export function interpolation3(
    prefix: string, v0: any, i0: string, v1: any, i1: string, v2: any, suffix: string): string|
    NO_CHANGE {
  let different = bindingUpdated2(v0, v1);
  different = bindingUpdated(v2) || different;

  return different ? prefix + stringify(v0) + i0 + stringify(v1) + i1 + stringify(v2) + suffix :
                     NO_CHANGE;
}

/** Create an interpolation binding with 4 expressions. */
export function interpolation4(
    prefix: string, v0: any, i0: string, v1: any, i1: string, v2: any, i2: string, v3: any,
    suffix: string): string|NO_CHANGE {
  const different = bindingUpdated4(v0, v1, v2, v3);

  return different ?
      prefix + stringify(v0) + i0 + stringify(v1) + i1 + stringify(v2) + i2 + stringify(v3) +
          suffix :
      NO_CHANGE;
}

/** Creates an interpolation binding with 5 expressions. */
export function interpolation5(
    prefix: string, v0: any, i0: string, v1: any, i1: string, v2: any, i2: string, v3: any,
    i3: string, v4: any, suffix: string): string|NO_CHANGE {
  let different = bindingUpdated4(v0, v1, v2, v3);
  different = bindingUpdated(v4) || different;

  return different ?
      prefix + stringify(v0) + i0 + stringify(v1) + i1 + stringify(v2) + i2 + stringify(v3) + i3 +
          stringify(v4) + suffix :
      NO_CHANGE;
}

/** Creates an interpolation binding with 6 expressions. */
export function interpolation6(
    prefix: string, v0: any, i0: string, v1: any, i1: string, v2: any, i2: string, v3: any,
    i3: string, v4: any, i4: string, v5: any, suffix: string): string|NO_CHANGE {
  let different = bindingUpdated4(v0, v1, v2, v3);
  different = bindingUpdated2(v4, v5) || different;

  return different ?
      prefix + stringify(v0) + i0 + stringify(v1) + i1 + stringify(v2) + i2 + stringify(v3) + i3 +
          stringify(v4) + i4 + stringify(v5) + suffix :
      NO_CHANGE;
}

/** Creates an interpolation binding with 7 expressions. */
export function interpolation7(
    prefix: string, v0: any, i0: string, v1: any, i1: string, v2: any, i2: string, v3: any,
    i3: string, v4: any, i4: string, v5: any, i5: string, v6: any, suffix: string): string|
    NO_CHANGE {
  let different = bindingUpdated4(v0, v1, v2, v3);
  different = bindingUpdated2(v4, v5) || different;
  different = bindingUpdated(v6) || different;

  return different ?
      prefix + stringify(v0) + i0 + stringify(v1) + i1 + stringify(v2) + i2 + stringify(v3) + i3 +
          stringify(v4) + i4 + stringify(v5) + i5 + stringify(v6) + suffix :
      NO_CHANGE;
}

/** Creates an interpolation binding with 8 expressions. */
export function interpolation8(
    prefix: string, v0: any, i0: string, v1: any, i1: string, v2: any, i2: string, v3: any,
    i3: string, v4: any, i4: string, v5: any, i5: string, v6: any, i6: string, v7: any,
    suffix: string): string|NO_CHANGE {
  let different = bindingUpdated4(v0, v1, v2, v3);
  different = bindingUpdated4(v4, v5, v6, v7) || different;

  return different ?
      prefix + stringify(v0) + i0 + stringify(v1) + i1 + stringify(v2) + i2 + stringify(v3) + i3 +
          stringify(v4) + i4 + stringify(v5) + i5 + stringify(v6) + i6 + stringify(v7) + suffix :
      NO_CHANGE;
}

/** Store a value in the `data` at a given `index`. */
export function store<T>(index: number, value: T): void {
  // We don't store any static data for local variables, so the first time
  // we see the template, we should store as null to avoid a sparse array
  if (index >= tData.length) {
    tData[index] = null;
  }
  data[index] = value;
}

/** Retrieves a value from the `data`. */
export function load<T>(index: number): T {
  ngDevMode && assertDataInRange(index);
  return data[index];
}

/** Retrieves a value from the `directives` array. */
export function loadDirective<T>(index: number): T {
  ngDevMode && assertNotNull(directives, 'Directives array should be defined if reading a dir.');
  ngDevMode && assertDataInRange(index, directives !);
  return directives ![index];
}

/** Gets the current binding value and increments the binding index. */
export function consumeBinding(): any {
  ngDevMode && assertDataInRange(currentView.bindingIndex);
  ngDevMode &&
      assertNotEqual(
          data[currentView.bindingIndex], NO_CHANGE, 'Stored value should never be NO_CHANGE.');
  return data[currentView.bindingIndex++];
}

/** Updates binding if changed, then returns whether it was updated. */
export function bindingUpdated(value: any): boolean {
  ngDevMode && assertNotEqual(value, NO_CHANGE, 'Incoming value should never be NO_CHANGE.');

  if (currentView.bindingStartIndex < 0) {
    initBindings();
  } else if (isDifferent(data[currentView.bindingIndex], value)) {
    throwErrorIfNoChangesMode(
        creationMode, checkNoChangesMode, data[currentView.bindingIndex], value);
  } else {
    currentView.bindingIndex++;
    return false;
  }

  data[currentView.bindingIndex++] = value;
  return true;
}

/** Updates binding if changed, then returns the latest value. */
export function checkAndUpdateBinding(value: any): any {
  bindingUpdated(value);
  return value;
}

/** Updates 2 bindings if changed, then returns whether either was updated. */
export function bindingUpdated2(exp1: any, exp2: any): boolean {
  const different = bindingUpdated(exp1);
  return bindingUpdated(exp2) || different;
}

/** Updates 4 bindings if changed, then returns whether any was updated. */
export function bindingUpdated4(exp1: any, exp2: any, exp3: any, exp4: any): boolean {
  const different = bindingUpdated2(exp1, exp2);
  return bindingUpdated2(exp3, exp4) || different;
}

export function getTView(): TView {
  return currentView.tView;
}

export function getDirectiveInstance<T>(instanceOrArray: T | [T]): T {
  // Directives with content queries store an array in directives[directiveIndex]
  // with the instance as the first index
  return Array.isArray(instanceOrArray) ? instanceOrArray[0] : instanceOrArray;
}

export function assertPreviousIsParent() {
  assertEqual(isParent, true, 'previousOrParentNode should be a parent');
}

function assertHasParent() {
  assertNotNull(previousOrParentNode.parent, 'previousOrParentNode should have a parent');
}

function assertDataInRange(index: number, arr?: any[]) {
  if (arr == null) arr = data;
  assertLessThan(index, arr ? arr.length : 0, 'index expected to be a valid data index');
}

function assertDataNext(index: number, arr?: any[]) {
  if (arr == null) arr = data;
  assertEqual(
      arr.length, index, `index ${index} expected to be at the end of arr (length ${arr.length})`);
}

export function _getComponentHostLElementNode<T>(component: T): LElementNode {
  ngDevMode && assertNotNull(component, 'expecting component got null');
  const lElementNode = (component as any)[NG_HOST_SYMBOL] as LElementNode;
  ngDevMode && assertNotNull(component, 'object is not a component');
  return lElementNode;
}

export const CLEAN_PROMISE = _CLEAN_PROMISE;
export const ROOT_DIRECTIVE_INDICES = _ROOT_DIRECTIVE_INDICES;
