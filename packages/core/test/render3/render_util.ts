/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {stringifyElement} from '@angular/platform-browser/testing/src/browser_util';

import {CreateComponentOptions} from '../../src/render3/component';
import {extractDirectiveDef, extractPipeDef} from '../../src/render3/definition';
import {ComponentDef, ComponentTemplate, ComponentType, DirectiveDef, DirectiveType, PublicFeature, RenderFlags, defineComponent, defineDirective, renderComponent as _renderComponent, tick} from '../../src/render3/index';
import {NG_HOST_SYMBOL, renderTemplate} from '../../src/render3/instructions';
import {DirectiveDefList, DirectiveDefListOrFactory, DirectiveTypesOrFactory, PipeDef, PipeDefList, PipeDefListOrFactory, PipeTypesOrFactory} from '../../src/render3/interfaces/definition';
import {LElementNode} from '../../src/render3/interfaces/node';
import {RElement, RText, Renderer3, RendererFactory3, domRendererFactory3} from '../../src/render3/interfaces/renderer';
import {Type} from '../../src/type';

import {getRendererFactory2} from './imported_renderer2';

export abstract class BaseFixture {
  hostElement: HTMLElement;

  constructor() {
    this.hostElement = document.createElement('div');
    this.hostElement.setAttribute('fixture', 'mark');
  }

  /**
   * Current state of rendered HTML.
   */
  get html(): string {
    return (this.hostElement as any as Element)
        .innerHTML.replace(/ style=""/g, '')
        .replace(/ class=""/g, '');
  }
}

function noop() {}
/**
 * Fixture for testing template functions in a convenient way.
 *
 * This fixture allows:
 * - specifying the creation block and update block as two separate functions,
 * - maintaining the template state between invocations,
 * - access to the render `html`.
 */
export class TemplateFixture extends BaseFixture {
  hostNode: LElementNode;
  private _directiveDefs: DirectiveDefList|null;
  private _pipeDefs: PipeDefList|null;
  /**
   *
   * @param createBlock Instructions which go into the creation block:
   *          `if (creationMode) { __here__ }`.
   * @param updateBlock Optional instructions which go after the creation block:
   *          `if (creationMode) { ... } __here__`.
   */
  constructor(
      private createBlock: () => void, private updateBlock: () => void = noop,
      directives?: DirectiveTypesOrFactory|null, pipes?: PipeTypesOrFactory|null) {
    super();
    this._directiveDefs = toDefs(directives, extractDirectiveDef);
    this._pipeDefs = toDefs(pipes, extractPipeDef);
    this.hostNode = renderTemplate(this.hostElement, (rf: RenderFlags, ctx: any) => {
      if (rf & RenderFlags.Create) {
        this.createBlock();
      }
      if (rf & RenderFlags.Update) {
        this.updateBlock();
      }
    }, null !, domRendererFactory3, null, this._directiveDefs, this._pipeDefs);
  }

  /**
   * Update the existing template
   *
   * @param updateBlock Optional update block.
   */
  update(updateBlock?: () => void): void {
    renderTemplate(
        this.hostNode.native, updateBlock || this.updateBlock, null !, domRendererFactory3,
        this.hostNode, this._directiveDefs, this._pipeDefs);
  }
}


/**
 * Fixture for testing Components in a convenient way.
 */
export class ComponentFixture<T> extends BaseFixture {
  component: T;
  requestAnimationFrame: {(fn: () => void): void; flush(): void; queue: (() => void)[];};

  constructor(private componentType: ComponentType<T>) {
    super();
    this.requestAnimationFrame = function(fn: () => void) {
      requestAnimationFrame.queue.push(fn);
    } as any;
    this.requestAnimationFrame.queue = [];
    this.requestAnimationFrame.flush = function() {
      while (requestAnimationFrame.queue.length) {
        requestAnimationFrame.queue.shift() !();
      }
    };

    this.component = _renderComponent(componentType, {
      host: this.hostElement,
      scheduler: this.requestAnimationFrame,
    });
  }

  update(): void {
    tick(this.component);
    this.requestAnimationFrame.flush();
  }
}

///////////////////////////////////////////////////////////////////////////////////
// The methods below use global state and we should stop using them.
// Fixtures above are preferred way of testing Components and Templates
///////////////////////////////////////////////////////////////////////////////////

export const document = ((global || window) as any).document;
export let containerEl: HTMLElement = null !;
let host: LElementNode|null;
const isRenderer2 =
    typeof process == 'object' && process.argv[3] && process.argv[3] === '--r=renderer2';
// tslint:disable-next-line:no-console
console.log(`Running tests with ${!isRenderer2 ? 'document' : 'Renderer2'} renderer...`);
const testRendererFactory: RendererFactory3 =
    isRenderer2 ? getRendererFactory2(document) : domRendererFactory3;

export const requestAnimationFrame:
    {(fn: () => void): void; flush(): void; queue: (() => void)[];} = function(fn: () => void) {
      requestAnimationFrame.queue.push(fn);
    } as any;
requestAnimationFrame.flush = function() {
  while (requestAnimationFrame.queue.length) {
    requestAnimationFrame.queue.shift() !();
  }
};

export function resetDOM() {
  requestAnimationFrame.queue = [];
  if (containerEl) {
    try {
      document.body.removeChild(containerEl);
    } catch (e) {
    }
  }
  containerEl = document.createElement('div');
  containerEl.setAttribute('host', '');
  document.body.appendChild(containerEl);
  host = null;
  // TODO: assert that the global state is clean (e.g. ngData, previousOrParentNode, etc)
}

/**
 * @deprecated use `TemplateFixture` or `ComponentFixture`
 */
export function renderToHtml(
    template: ComponentTemplate<any>, ctx: any, directives?: DirectiveTypesOrFactory | null,
    pipes?: PipeTypesOrFactory | null, providedRendererFactory?: RendererFactory3 | null) {
  host = renderTemplate(
      containerEl, template, ctx, providedRendererFactory || testRendererFactory, host,
      toDefs(directives, extractDirectiveDef), toDefs(pipes, extractPipeDef));
  return toHtml(containerEl);
}

function toDefs(
    types: DirectiveTypesOrFactory | undefined | null,
    mapFn: (type: Type<any>) => DirectiveDef<any>): DirectiveDefList|null;
function toDefs(
    types: PipeTypesOrFactory | undefined | null,
    mapFn: (type: Type<any>) => PipeDef<any>): PipeDefList|null;
function toDefs(
    types: PipeTypesOrFactory | DirectiveTypesOrFactory | undefined | null,
    mapFn: (type: Type<any>) => PipeDef<any>| DirectiveDef<any>): any {
  if (!types) return null;
  if (typeof types == 'function') {
    types = types();
  }
  return types.map(mapFn);
}

beforeEach(resetDOM);

/**
 * @deprecated use `TemplateFixture` or `ComponentFixture`
 */
export function renderComponent<T>(type: ComponentType<T>, opts?: CreateComponentOptions): T {
  return _renderComponent(type, {
    rendererFactory: opts && opts.rendererFactory || testRendererFactory,
    host: containerEl,
    scheduler: requestAnimationFrame,
    hostFeatures: opts && opts.hostFeatures
  });
}

/**
 * @deprecated use `TemplateFixture` or `ComponentFixture`
 */
export function toHtml<T>(componentOrElement: T | RElement): string {
  const node = (componentOrElement as any)[NG_HOST_SYMBOL] as LElementNode;
  if (node) {
    return toHtml(node.native);
  } else {
    return stringifyElement(componentOrElement)
        .replace(/^<div host="">/, '')
        .replace(/<\/div>$/, '')
        .replace(' style=""', '')
        .replace(/<!--[\w]*-->/g, '');
  }
}

export function createComponent(
    name: string, template: ComponentTemplate<any>, directives: DirectiveTypesOrFactory = [],
    pipes: PipeTypesOrFactory = []): ComponentType<any> {
  return class Component {
    value: any;
    static ngComponentDef = defineComponent({
      type: Component,
      selectors: [[name]],
      factory: () => new Component,
      template: template,
      features: [PublicFeature],
      directives: directives,
      pipes: pipes
    });
  };
}

export function createDirective(
    name: string, {exportAs}: {exportAs?: string} = {}): DirectiveType<any> {
  return class Directive {
    static ngDirectiveDef = defineDirective({
      type: Directive,
      selectors: [['', name, '']],
      factory: () => new Directive(),
      features: [PublicFeature],
      exportAs: exportAs,
    });
  };
}


// Verify that DOM is a type of render. This is here for error checking only and has no use.
export const renderer: Renderer3 = null as any as Document;
export const element: RElement = null as any as HTMLElement;
export const text: RText = null as any as Text;
