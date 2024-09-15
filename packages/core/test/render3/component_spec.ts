/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */


import {DoCheck, ViewEncapsulation} from '../../src/core';
import {getRenderedText} from '../../src/render3/component';
import {LifecycleHooksFeature, defineComponent, markDirty} from '../../src/render3/index';
import {bind, container, containerRefreshEnd, containerRefreshStart, elementEnd, elementProperty, elementStart, embeddedViewEnd, embeddedViewStart, text, textBinding, tick} from '../../src/render3/instructions';
import {RenderFlags} from '../../src/render3/interfaces/definition';
import {createRendererType2} from '../../src/view/index';

import {getRendererFactory2} from './imported_renderer2';
import {containerEl, renderComponent, renderToHtml, requestAnimationFrame, toHtml} from './render_util';

describe('component', () => {
  class CounterComponent {
    count = 0;

    increment() { this.count++; }

    static ngComponentDef = defineComponent({
      type: CounterComponent,
      selectors: [['counter']],
      template: function(rf: RenderFlags, ctx: CounterComponent) {
        if (rf & RenderFlags.Create) {
          text(0);
        }
        if (rf & RenderFlags.Update) {
          textBinding(0, bind(ctx.count));
        }
      },
      factory: () => new CounterComponent,
      inputs: {count: 'count'},
    });
  }

  describe('renderComponent', () => {
    it('should render on initial call', () => {
      renderComponent(CounterComponent);
      expect(toHtml(containerEl)).toEqual('0');
    });

    it('should re-render on input change or method invocation', () => {
      const component = renderComponent(CounterComponent);
      expect(toHtml(containerEl)).toEqual('0');
      component.count = 123;
      markDirty(component);
      expect(toHtml(containerEl)).toEqual('0');
      requestAnimationFrame.flush();
      expect(toHtml(containerEl)).toEqual('123');
      component.increment();
      markDirty(component);
      expect(toHtml(containerEl)).toEqual('123');
      requestAnimationFrame.flush();
      expect(toHtml(containerEl)).toEqual('124');
    });

  });

});

describe('component with a container', () => {

  function showItems(rf: RenderFlags, ctx: {items: string[]}) {
    if (rf & RenderFlags.Create) {
      container(0);
    }
    if (rf & RenderFlags.Update) {
      containerRefreshStart(0);
      {
        for (const item of ctx.items) {
          const rf0 = embeddedViewStart(0);
          {
            if (rf0 & RenderFlags.Create) {
              text(0);
            }
            if (rf0 & RenderFlags.Update) {
              textBinding(0, bind(item));
            }
          }
          embeddedViewEnd();
        }
      }
      containerRefreshEnd();
    }
  }

  class WrapperComponent {
    items: string[];
    static ngComponentDef = defineComponent({
      type: WrapperComponent,
      selectors: [['wrapper']],
      template: function ChildComponentTemplate(rf: RenderFlags, ctx: {items: string[]}) {
        if (rf & RenderFlags.Create) {
          container(0);
        }
        if (rf & RenderFlags.Update) {
          containerRefreshStart(0);
          {
            const rf0 = embeddedViewStart(0);
            { showItems(rf0, {items: ctx.items}); }
            embeddedViewEnd();
          }
          containerRefreshEnd();
        }
      },
      factory: () => new WrapperComponent,
      inputs: {items: 'items'}
    });
  }

  function template(rf: RenderFlags, ctx: {items: string[]}) {
    if (rf & RenderFlags.Create) {
      elementStart(0, 'wrapper');
      elementEnd();
    }
    if (rf & RenderFlags.Update) {
      elementProperty(0, 'items', bind(ctx.items));
    }
  }

  const defs = [WrapperComponent];

  it('should re-render on input change', () => {
    const ctx: {items: string[]} = {items: ['a']};
    expect(renderToHtml(template, ctx, defs)).toEqual('<wrapper>a</wrapper>');

    ctx.items = [...ctx.items, 'b'];
    expect(renderToHtml(template, ctx, defs)).toEqual('<wrapper>ab</wrapper>');
  });

});

// TODO: add tests with Native once tests are run in real browser (domino doesn't support shadow
// root)
describe('encapsulation', () => {
  class WrapperComponent {
    static ngComponentDef = defineComponent({
      type: WrapperComponent,
      selectors: [['wrapper']],
      template: function(rf: RenderFlags, ctx: WrapperComponent) {
        if (rf & RenderFlags.Create) {
          elementStart(0, 'encapsulated');
          elementEnd();
        }
      },
      factory: () => new WrapperComponent,
      directives: () => [EncapsulatedComponent]
    });
  }

  class EncapsulatedComponent {
    static ngComponentDef = defineComponent({
      type: EncapsulatedComponent,
      selectors: [['encapsulated']],
      template: function(rf: RenderFlags, ctx: EncapsulatedComponent) {
        if (rf & RenderFlags.Create) {
          text(0, 'foo');
          elementStart(1, 'leaf');
          elementEnd();
        }
      },
      factory: () => new EncapsulatedComponent,
      rendererType:
          createRendererType2({encapsulation: ViewEncapsulation.Emulated, styles: [], data: {}}),
      directives: () => [LeafComponent]
    });
  }

  class LeafComponent {
    static ngComponentDef = defineComponent({
      type: LeafComponent,
      selectors: [['leaf']],
      template: function(rf: RenderFlags, ctx: LeafComponent) {
        if (rf & RenderFlags.Create) {
          elementStart(0, 'span');
          { text(1, 'bar'); }
          elementEnd();
        }
      },
      factory: () => new LeafComponent,
    });
  }

  it('should encapsulate children, but not host nor grand children', () => {
    renderComponent(WrapperComponent, {rendererFactory: getRendererFactory2(document)});
    expect(containerEl.outerHTML)
        .toMatch(
            /<div host=""><encapsulated _nghost-c(\d+)="">foo<leaf _ngcontent-c\1=""><span>bar<\/span><\/leaf><\/encapsulated><\/div>/);
  });

  it('should encapsulate host', () => {
    renderComponent(EncapsulatedComponent, {rendererFactory: getRendererFactory2(document)});
    expect(containerEl.outerHTML)
        .toMatch(
            /<div host="" _nghost-c(\d+)="">foo<leaf _ngcontent-c\1=""><span>bar<\/span><\/leaf><\/div>/);
  });

  it('should encapsulate host and children with different attributes', () => {
    class WrapperComponentWith {
      static ngComponentDef = defineComponent({
        type: WrapperComponentWith,
        selectors: [['wrapper']],
        template: function(rf: RenderFlags, ctx: WrapperComponentWith) {
          if (rf & RenderFlags.Create) {
            elementStart(0, 'leaf');
            elementEnd();
          }
        },
        factory: () => new WrapperComponentWith,
        rendererType:
            createRendererType2({encapsulation: ViewEncapsulation.Emulated, styles: [], data: {}}),
        directives: () => [LeafComponentwith]
      });
    }

    class LeafComponentwith {
      static ngComponentDef = defineComponent({
        type: LeafComponentwith,
        selectors: [['leaf']],
        template: function(rf: RenderFlags, ctx: LeafComponentwith) {
          if (rf & RenderFlags.Create) {
            elementStart(0, 'span');
            { text(1, 'bar'); }
            elementEnd();
          }
        },
        factory: () => new LeafComponentwith,
        rendererType:
            createRendererType2({encapsulation: ViewEncapsulation.Emulated, styles: [], data: {}}),
      });
    }

    renderComponent(WrapperComponentWith, {rendererFactory: getRendererFactory2(document)});
    expect(containerEl.outerHTML)
        .toMatch(
            /<div host="" _nghost-c(\d+)=""><leaf _ngcontent-c\1="" _nghost-c(\d+)=""><span _ngcontent-c\2="">bar<\/span><\/leaf><\/div>/);
  });

});

describe('recursive components', () => {
  let events: string[] = [];
  let count = 0;

  class TreeNode {
    constructor(
        public value: number, public depth: number, public left: TreeNode|null,
        public right: TreeNode|null) {}
  }

  class TreeComponent {
    data: TreeNode = _buildTree(0);

    ngDoCheck() { events.push('check' + this.data.value); }

    static ngComponentDef = defineComponent({
      type: TreeComponent,
      selectors: [['tree-comp']],
      factory: () => new TreeComponent(),
      template: (rf: RenderFlags, ctx: TreeComponent) => {
        if (rf & RenderFlags.Create) {
          text(0);
          container(1);
          container(2);
        }
        if (rf & RenderFlags.Update) {
          textBinding(0, bind(ctx.data.value));
          containerRefreshStart(1);
          {
            if (ctx.data.left != null) {
              let rf0 = embeddedViewStart(0);
              if (rf0 & RenderFlags.Create) {
                elementStart(0, 'tree-comp');
                elementEnd();
              }
              if (rf0 & RenderFlags.Update) {
                elementProperty(0, 'data', bind(ctx.data.left));
              }
              embeddedViewEnd();
            }
          }
          containerRefreshEnd();
          containerRefreshStart(2);
          {
            if (ctx.data.right != null) {
              let rf0 = embeddedViewStart(0);
              if (rf0 & RenderFlags.Create) {
                elementStart(0, 'tree-comp');
                elementEnd();
              }
              if (rf0 & RenderFlags.Update) {
                elementProperty(0, 'data', bind(ctx.data.right));
              }
              embeddedViewEnd();
            }
          }
          containerRefreshEnd();
        }
      },
      inputs: {data: 'data'}
    });
  }

  TreeComponent.ngComponentDef.directiveDefs = () => [TreeComponent.ngComponentDef];

  function _buildTree(currDepth: number): TreeNode {
    const children = currDepth < 2 ? _buildTree(currDepth + 1) : null;
    const children2 = currDepth < 2 ? _buildTree(currDepth + 1) : null;
    return new TreeNode(count++, currDepth, children, children2);
  }

  it('should check each component just once', () => {
    const comp = renderComponent(TreeComponent, {hostFeatures: [LifecycleHooksFeature]});
    expect(getRenderedText(comp)).toEqual('6201534');
    expect(events).toEqual(['check6', 'check2', 'check0', 'check1', 'check5', 'check3', 'check4']);

    events = [];
    tick(comp);
    expect(events).toEqual(['check6', 'check2', 'check0', 'check1', 'check5', 'check3', 'check4']);
  });
});
