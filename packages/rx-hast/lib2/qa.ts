import { EMPTY, map, Observable, scan } from "rxjs";
import { component, NewComponent, parentComponent } from "./component.js";
import { CycleComponent, mapComponent, mapParentComponent } from "./map.js";
import { proxifyObservable } from "./proxy.js";
import { keyedSiblings } from "./siblings.js";
import { CSSProperties } from "react";

const testParent = parentComponent<{}, { onAbort: Observable<unknown> }>()(
  (child) =>
    component("div", ["style"], ["onClick"], {}, keyedSiblings({ child }))
);

const testImpl = testParent(component("input", ["color"], ["onAbort"], {}));

const testMap = mapParentComponent(
  testParent,
  (
    getEvent,
    newAttrs: { hello: Observable<boolean> },
    getChildEvent,
    newChildAttrs
  ) => {
    const thing = getEvent((e) => e.onClick);

    return {
      attrs: {
        style: thing.pipe(map(() => "color: green" as CSSProperties))
      },
      newEvents: {
        myStyle: thing
      },
      childAttrs: {},
      newChildEvents: {}
    };
  }
);

declare const thing: <A>(
  selector: (events: {
    onClick: Observable<void>;
    nums: number[];
    num: number;
  }) => Observable<A>
) => Observable<A>;

thing((e) => e.onClick);

const test = proxifyObservable(thing);

test.onClick();

declare const testComp: NewComponent<
  { text: Observable<string> },
  { onClick: Observable<void> }
>;

const counterProgram: CycleComponent<typeof testComp> = (getEvent) => ({
  text: getEvent((e) => e.onClick).pipe(
    scan((acc) => acc + 1, 0),
    map(String)
  )
});

const counterButton = mapComponent(testComp, (getEvent) => {
  return { attrs: counterProgram(getEvent), newEvents: {} };
});

declare const modal: NewComponent<
  { darkMode: Observable<"light" | "dark">; open: Observable<void> },
  { state: Observable<"open" | "closed"> }
>;

declare const button: NewComponent<
  { darkMode: Observable<"light" | "dark"> },
  { onClick: Observable<void> }
>;

declare const rawApp: NewComponent<
  { darkMode: Observable<"light" | "dark">; modal: { open: Observable<void> } },
  {
    button: { onClick: Observable<void> };
    modal: { state: Observable<"open" | "closed"> };
  }
>;

const app = mapComponent(
  rawApp,
  (getEvent, newAttrs: { darkMode: Observable<"light" | "dark"> }) => ({
    newEvents: { state: getEvent((e) => e.modal.state) },
    attrs: {
      darkMode: newAttrs.darkMode,
      modal: {
        open: getEvent((e) => e.button.onClick)
      }
    }
  })
);
