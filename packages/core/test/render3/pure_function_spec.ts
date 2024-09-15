/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {defineComponent} from '../../src/render3/index';
import {bind, container, containerRefreshEnd, containerRefreshStart, elementEnd, elementProperty, elementStart, embeddedViewEnd, embeddedViewStart, load, loadDirective} from '../../src/render3/instructions';
import {RenderFlags} from '../../src/render3/interfaces/definition';
import {pureFunction1, pureFunction2, pureFunction3, pureFunction4, pureFunction5, pureFunction6, pureFunction7, pureFunction8, pureFunctionV} from '../../src/render3/pure_function';
import {renderToHtml} from '../../test/render3/render_util';

describe('array literals', () => {
  let myComp: MyComp;

  class MyComp {
    names: string[];

    static ngComponentDef = defineComponent({
      type: MyComp,
      selectors: [['my-comp']],
      factory: function MyComp_Factory() { return myComp = new MyComp(); },
      template: function MyComp_Template(rf: RenderFlags, ctx: MyComp) {},
      inputs: {names: 'names'}
    });
  }

  const directives = [MyComp];

  it('should support an array literal with a binding', () => {
    const e0_ff = (v: any) => ['Nancy', v, 'Bess'];

    /** <my-comp [names]="['Nancy', customName, 'Bess']"></my-comp> */
    function Template(rf: RenderFlags, ctx: any) {
      if (rf & RenderFlags.Create) {
        elementStart(0, 'my-comp');
        elementEnd();
      }
      if (rf & RenderFlags.Update) {
        elementProperty(0, 'names', bind(pureFunction1(e0_ff, ctx.customName)));
      }
    }

    renderToHtml(Template, {customName: 'Carson'}, directives);
    const firstArray = myComp !.names;
    expect(firstArray).toEqual(['Nancy', 'Carson', 'Bess']);

    renderToHtml(Template, {customName: 'Carson'}, directives);
    expect(myComp !.names).toEqual(['Nancy', 'Carson', 'Bess']);
    expect(firstArray).toBe(myComp !.names);

    renderToHtml(Template, {customName: 'Hannah'}, directives);
    expect(myComp !.names).toEqual(['Nancy', 'Hannah', 'Bess']);

    // Identity must change if binding changes
    expect(firstArray).not.toBe(myComp !.names);

    // The property should not be set if the exp value is the same, so artificially
    // setting the property to ensure it's not overwritten.
    myComp !.names = ['should not be overwritten'];
    renderToHtml(Template, {customName: 'Hannah'}, directives);
    expect(myComp !.names).toEqual(['should not be overwritten']);
  });

  it('should support multiple array literals passed through to one node', () => {
    let manyPropComp: ManyPropComp;

    class ManyPropComp {
      names1: string[];
      names2: string[];

      static ngComponentDef = defineComponent({
        type: ManyPropComp,
        selectors: [['many-prop-comp']],
        factory: function ManyPropComp_Factory() { return manyPropComp = new ManyPropComp(); },
        template: function ManyPropComp_Template(rf: RenderFlags, ctx: ManyPropComp) {},
        inputs: {names1: 'names1', names2: 'names2'}
      });
    }

    const e0_ff = (v: any) => ['Nancy', v];
    const e0_ff_1 = (v: any) => [v];

    /**
     * <many-prop-comp [names1]="['Nancy', customName]" [names2]="[customName2]">
     * </many-prop-comp>
     */
    function Template(rf: RenderFlags, ctx: any) {
      if (rf & RenderFlags.Create) {
        elementStart(0, 'many-prop-comp');
        elementEnd();
      }
      if (rf & RenderFlags.Update) {
        elementProperty(0, 'names1', bind(pureFunction1(e0_ff, ctx.customName)));
        elementProperty(0, 'names2', bind(pureFunction1(e0_ff_1, ctx.customName2)));
      }
    }

    const defs = [ManyPropComp];
    renderToHtml(Template, {customName: 'Carson', customName2: 'George'}, defs);
    expect(manyPropComp !.names1).toEqual(['Nancy', 'Carson']);
    expect(manyPropComp !.names2).toEqual(['George']);

    renderToHtml(Template, {customName: 'George', customName2: 'Carson'}, defs);
    expect(manyPropComp !.names1).toEqual(['Nancy', 'George']);
    expect(manyPropComp !.names2).toEqual(['Carson']);
  });

  it('should support an array literals inside fn calls', () => {
    let myComps: MyComp[] = [];

    const e0_ff = (v: any) => ['Nancy', v];

    /** <my-comp [names]="someFn(['Nancy', customName])"></my-comp> */
    class ParentComp {
      customName = 'Bess';

      someFn(arr: string[]): string[] {
        arr[0] = arr[0].toUpperCase();
        return arr;
      }

      static ngComponentDef = defineComponent({
        type: ParentComp,
        selectors: [['parent-comp']],
        factory: () => new ParentComp(),
        template: function(rf: RenderFlags, ctx: any) {
          if (rf & RenderFlags.Create) {
            elementStart(0, 'my-comp');
            myComps.push(loadDirective(0));
            elementEnd();
          }
          if (rf & RenderFlags.Update) {
            elementProperty(0, 'names', bind(ctx.someFn(pureFunction1(e0_ff, ctx.customName))));
          }
        },
        directives: directives
      });
    }

    function Template(rf: RenderFlags, ctx: any) {
      if (rf & RenderFlags.Create) {
        elementStart(0, 'parent-comp');
        elementEnd();
        elementStart(1, 'parent-comp');
        elementEnd();
      }
    }

    renderToHtml(Template, {}, [ParentComp]);
    const firstArray = myComps[0].names;
    const secondArray = myComps[1].names;
    expect(firstArray).toEqual(['NANCY', 'Bess']);
    expect(secondArray).toEqual(['NANCY', 'Bess']);
    expect(firstArray).not.toBe(secondArray);

    renderToHtml(Template, {}, [ParentComp]);
    expect(firstArray).toEqual(['NANCY', 'Bess']);
    expect(secondArray).toEqual(['NANCY', 'Bess']);
    expect(firstArray).toBe(myComps[0].names);
    expect(secondArray).toBe(myComps[1].names);
  });

  it('should support an array literal with more than 1 binding', () => {
    const e0_ff = (v1: any, v2: any) => ['Nancy', v1, 'Bess', v2];

    /** <my-comp [names]="['Nancy', customName, 'Bess', customName2]"></my-comp> */
    function Template(rf: RenderFlags, ctx: any) {
      if (rf & RenderFlags.Create) {
        elementStart(0, 'my-comp');
        elementEnd();
      }
      if (rf & RenderFlags.Update) {
        elementProperty(0, 'names', bind(pureFunction2(e0_ff, ctx.customName, ctx.customName2)));
      }
    }

    renderToHtml(Template, {customName: 'Carson', customName2: 'Hannah'}, directives);
    const firstArray = myComp !.names;
    expect(firstArray).toEqual(['Nancy', 'Carson', 'Bess', 'Hannah']);

    renderToHtml(Template, {customName: 'Carson', customName2: 'Hannah'}, directives);
    expect(myComp !.names).toEqual(['Nancy', 'Carson', 'Bess', 'Hannah']);
    expect(firstArray).toBe(myComp !.names);

    renderToHtml(Template, {customName: 'George', customName2: 'Hannah'}, directives);
    expect(myComp !.names).toEqual(['Nancy', 'George', 'Bess', 'Hannah']);
    expect(firstArray).not.toBe(myComp !.names);

    renderToHtml(Template, {customName: 'Frank', customName2: 'Ned'}, directives);
    expect(myComp !.names).toEqual(['Nancy', 'Frank', 'Bess', 'Ned']);

    // The property should not be set if the exp value is the same, so artificially
    // setting the property to ensure it's not overwritten.
    myComp !.names = ['should not be overwritten'];
    renderToHtml(Template, {customName: 'Frank', customName2: 'Ned'}, directives);
    expect(myComp !.names).toEqual(['should not be overwritten']);
  });

  it('should work up to 8 bindings', () => {
    let f3Comp: MyComp;
    let f4Comp: MyComp;
    let f5Comp: MyComp;
    let f6Comp: MyComp;
    let f7Comp: MyComp;
    let f8Comp: MyComp;


    const e0_ff = (v1: any, v2: any, v3: any) => ['a', 'b', 'c', 'd', 'e', v1, v2, v3];
    const e2_ff = (v1: any, v2: any, v3: any, v4: any) => ['a', 'b', 'c', 'd', v1, v2, v3, v4];
    const e4_ff =
        (v1: any, v2: any, v3: any, v4: any, v5: any) => ['a', 'b', 'c', v1, v2, v3, v4, v5];
    const e6_ff =
        (v1: any, v2: any, v3: any, v4: any, v5: any,
         v6: any) => ['a', 'b', v1, v2, v3, v4, v5, v6];
    const e8_ff =
        (v1: any, v2: any, v3: any, v4: any, v5: any, v6: any,
         v7: any) => ['a', v1, v2, v3, v4, v5, v6, v7];
    const e10_ff =
        (v1: any, v2: any, v3: any, v4: any, v5: any, v6: any, v7: any,
         v8: any) => [v1, v2, v3, v4, v5, v6, v7, v8];

    function Template(rf: RenderFlags, c: any) {
      if (rf & RenderFlags.Create) {
        elementStart(0, 'my-comp');
        f3Comp = loadDirective(0);
        elementEnd();
        elementStart(1, 'my-comp');
        f4Comp = loadDirective(1);
        elementEnd();
        elementStart(2, 'my-comp');
        f5Comp = loadDirective(2);
        elementEnd();
        elementStart(3, 'my-comp');
        f6Comp = loadDirective(3);
        elementEnd();
        elementStart(4, 'my-comp');
        f7Comp = loadDirective(4);
        elementEnd();
        elementStart(5, 'my-comp');
        f8Comp = loadDirective(5);
        elementEnd();
      }
      if (rf & RenderFlags.Update) {
        elementProperty(0, 'names', bind(pureFunction3(e0_ff, c[5], c[6], c[7])));
        elementProperty(1, 'names', bind(pureFunction4(e2_ff, c[4], c[5], c[6], c[7])));
        elementProperty(2, 'names', bind(pureFunction5(e4_ff, c[3], c[4], c[5], c[6], c[7])));
        elementProperty(3, 'names', bind(pureFunction6(e6_ff, c[2], c[3], c[4], c[5], c[6], c[7])));
        elementProperty(
            4, 'names', bind(pureFunction7(e8_ff, c[1], c[2], c[3], c[4], c[5], c[6], c[7])));
        elementProperty(
            5, 'names',
            bind(pureFunction8(e10_ff, c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7])));
      }
    }

    renderToHtml(Template, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], directives);
    expect(f3Comp !.names).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    expect(f4Comp !.names).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    expect(f5Comp !.names).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    expect(f6Comp !.names).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    expect(f7Comp !.names).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    expect(f8Comp !.names).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);

    renderToHtml(Template, ['a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1', 'i1'], directives);
    expect(f3Comp !.names).toEqual(['a', 'b', 'c', 'd', 'e', 'f1', 'g1', 'h1']);
    expect(f4Comp !.names).toEqual(['a', 'b', 'c', 'd', 'e1', 'f1', 'g1', 'h1']);
    expect(f5Comp !.names).toEqual(['a', 'b', 'c', 'd1', 'e1', 'f1', 'g1', 'h1']);
    expect(f6Comp !.names).toEqual(['a', 'b', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1']);
    expect(f7Comp !.names).toEqual(['a', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1']);
    expect(f8Comp !.names).toEqual(['a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1']);

    renderToHtml(Template, ['a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h2', 'i1'], directives);
    expect(f3Comp !.names).toEqual(['a', 'b', 'c', 'd', 'e', 'f1', 'g1', 'h2']);
    expect(f4Comp !.names).toEqual(['a', 'b', 'c', 'd', 'e1', 'f1', 'g1', 'h2']);
    expect(f5Comp !.names).toEqual(['a', 'b', 'c', 'd1', 'e1', 'f1', 'g1', 'h2']);
    expect(f6Comp !.names).toEqual(['a', 'b', 'c1', 'd1', 'e1', 'f1', 'g1', 'h2']);
    expect(f7Comp !.names).toEqual(['a', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h2']);
    expect(f8Comp !.names).toEqual(['a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h2']);
  });

  it('should work with pureFunctionV for 9+ bindings', () => {
    const e0_ff =
        (v0: any, v1: any, v2: any, v3: any, v4: any, v5: any, v6: any, v7: any,
         v8: any) => ['start', v0, v1, v2, v3, v4, v5, v6, v7, v8, 'end'];
    const e0_ff_1 = (v: any) => { return {name: v}; };

    renderToHtml(Template, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], directives);
    /**
     * <my-comp [names]="['start', v0, v1, v2, v3, {name: v4}, v5, v6, v7, v8, 'end']">
     * </my-comp>
     */
    function Template(rf: RenderFlags, c: any) {
      if (rf & RenderFlags.Create) {
        elementStart(0, 'my-comp');
        elementEnd();
      }
      if (rf & RenderFlags.Update) {
        elementProperty(
            0, 'names', bind(pureFunctionV(e0_ff, [
              c[0], c[1], c[2], c[3], pureFunction1(e0_ff_1, c[4]), c[5], c[6], c[7], c[8]
            ])));
      }
    }

    expect(myComp !.names).toEqual([
      'start', 'a', 'b', 'c', 'd', {name: 'e'}, 'f', 'g', 'h', 'i', 'end'
    ]);

    renderToHtml(Template, ['a1', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], directives);
    expect(myComp !.names).toEqual([
      'start', 'a1', 'b', 'c', 'd', {name: 'e'}, 'f', 'g', 'h', 'i', 'end'
    ]);

    renderToHtml(Template, ['a1', 'b', 'c', 'd', 'e5', 'f', 'g', 'h', 'i'], directives);
    expect(myComp !.names).toEqual([
      'start', 'a1', 'b', 'c', 'd', {name: 'e5'}, 'f', 'g', 'h', 'i', 'end'
    ]);
  });

});
describe('object literals', () => {
  let objectComp: ObjectComp;

  class ObjectComp {
    config: {[key: string]: any};

    static ngComponentDef = defineComponent({
      type: ObjectComp,
      selectors: [['object-comp']],
      factory: function ObjectComp_Factory() { return objectComp = new ObjectComp(); },
      template: function ObjectComp_Template(rf: RenderFlags, ctx: ObjectComp) {},
      inputs: {config: 'config'}
    });
  }

  const defs = [ObjectComp];

  it('should support an object literal', () => {
    const e0_ff = (v: any) => { return {duration: 500, animation: v}; };

    /** <object-comp [config]="{duration: 500, animation: name}"></object-comp> */
    function Template(rf: RenderFlags, ctx: any) {
      if (rf & RenderFlags.Create) {
        elementStart(0, 'object-comp');
        elementEnd();
      }
      if (rf & RenderFlags.Update) {
        elementProperty(0, 'config', bind(pureFunction1(e0_ff, ctx.name)));
      }
    }

    renderToHtml(Template, {name: 'slide'}, defs);
    const firstObj = objectComp !.config;
    expect(objectComp !.config).toEqual({duration: 500, animation: 'slide'});

    renderToHtml(Template, {name: 'slide'}, defs);
    expect(objectComp !.config).toEqual({duration: 500, animation: 'slide'});
    expect(firstObj).toBe(objectComp !.config);

    renderToHtml(Template, {name: 'tap'}, defs);
    expect(objectComp !.config).toEqual({duration: 500, animation: 'tap'});

    // Identity must change if binding changes
    expect(firstObj).not.toBe(objectComp !.config);
  });

  it('should support expressions nested deeply in object/array literals', () => {
    const e0_ff = (v1: any, v2: any) => { return {animation: v1, actions: v2}; };
    const e0_ff_1 = (v: any) => [{opacity: 0, duration: 0}, v];
    const e0_ff_2 = (v: any) => { return {opacity: 1, duration: v}; };

    /**
     * <object-comp [config]="{animation: name, actions: [{ opacity: 0, duration: 0}, {opacity: 1,
     * duration: duration }]}">
     * </object-comp>
     */
    function Template(rf: RenderFlags, ctx: any) {
      if (rf & RenderFlags.Create) {
        elementStart(0, 'object-comp');
        elementEnd();
      }
      if (rf & RenderFlags.Update) {
        elementProperty(
            0, 'config',
            bind(pureFunction2(
                e0_ff, ctx.name, pureFunction1(e0_ff_1, pureFunction1(e0_ff_2, ctx.duration)))));
      }
    }

    renderToHtml(Template, {name: 'slide', duration: 100}, defs);
    expect(objectComp !.config).toEqual({
      animation: 'slide',
      actions: [{opacity: 0, duration: 0}, {opacity: 1, duration: 100}]
    });
    const firstConfig = objectComp !.config;

    renderToHtml(Template, {name: 'slide', duration: 100}, defs);
    expect(objectComp !.config).toEqual({
      animation: 'slide',
      actions: [{opacity: 0, duration: 0}, {opacity: 1, duration: 100}]
    });
    expect(objectComp !.config).toBe(firstConfig);

    renderToHtml(Template, {name: 'slide', duration: 50}, defs);
    expect(objectComp !.config).toEqual({
      animation: 'slide',
      actions: [{opacity: 0, duration: 0}, {opacity: 1, duration: 50}]
    });
    expect(objectComp !.config).not.toBe(firstConfig);

    renderToHtml(Template, {name: 'tap', duration: 50}, defs);
    expect(objectComp !.config).toEqual({
      animation: 'tap',
      actions: [{opacity: 0, duration: 0}, {opacity: 1, duration: 50}]
    });

    renderToHtml(Template, {name: 'drag', duration: 500}, defs);
    expect(objectComp !.config).toEqual({
      animation: 'drag',
      actions: [{opacity: 0, duration: 0}, {opacity: 1, duration: 500}]
    });

    // The property should not be set if the exp value is the same, so artificially
    // setting the property to ensure it's not overwritten.
    objectComp !.config = ['should not be overwritten'];
    renderToHtml(Template, {name: 'drag', duration: 500}, defs);
    expect(objectComp !.config).toEqual(['should not be overwritten']);
  });

  it('should support multiple view instances with multiple bindings', () => {
    let objectComps: ObjectComp[] = [];

    /**
     * % for(let i = 0; i < 2; i++) {
     *   <object-comp [config]="{opacity: configs[i].opacity, duration: configs[i].duration}">
     *   </object-comp>
     * % }
     */
    function Template(rf: RenderFlags, ctx: any) {
      if (rf & RenderFlags.Create) {
        container(0);
      }
      if (rf & RenderFlags.Update) {
        containerRefreshStart(0);
        {
          for (let i = 0; i < 2; i++) {
            let rf1 = embeddedViewStart(0);
            if (rf1 & RenderFlags.Create) {
              elementStart(0, 'object-comp');
              objectComps.push(loadDirective(0));
              elementEnd();
            }
            if (rf1 & RenderFlags.Update) {
              elementProperty(
                  0, 'config',
                  bind(pureFunction2(e0_ff, ctx.configs[i].opacity, ctx.configs[i].duration)));
            }
            embeddedViewEnd();
          }
        }
        containerRefreshEnd();
      }
    }

    const e0_ff = (v1: any, v2: any) => { return {opacity: v1, duration: v2}; };

    const configs = [{opacity: 0, duration: 500}, {opacity: 1, duration: 600}];
    renderToHtml(Template, {configs}, defs);
    expect(objectComps[0].config).toEqual({opacity: 0, duration: 500});
    expect(objectComps[1].config).toEqual({opacity: 1, duration: 600});

    configs[0].duration = 1000;
    renderToHtml(Template, {configs}, defs);
    expect(objectComps[0].config).toEqual({opacity: 0, duration: 1000});
    expect(objectComps[1].config).toEqual({opacity: 1, duration: 600});
  });

});
