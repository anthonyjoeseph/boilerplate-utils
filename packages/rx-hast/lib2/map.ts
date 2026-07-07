import { defer, merge, Observable } from "rxjs";
import { GetAttributes, GetEvents, NewComponent } from "./component.js";
import { ShallowAnd } from "./util.js";

export const mapComponent = <
  Attributes extends Record<string, unknown> = {},
  Events extends Record<string, unknown> = {},
  NewAttributes extends Record<string, unknown> = {},
  NewEvents extends Record<string, unknown> = {},
>(
  component: NewComponent<Attributes, Events>,
  fn: (
    getEvent: <A>(selector: (events: Events) => Observable<A>) => Observable<A>,
    newAttrs: NewAttributes,
  ) => { attrs: Attributes; newEvents: NewEvents },
): NewComponent<NewAttributes, NewEvents> => {
  return {
    node: component.node,
    hydrate: (self, domEmissions, newAttrs) => {
      const { attrs, newEvents } = fn(
        (selector) => defer(() => selector(events)),
        newAttrs,
      );
      const { events, domActions } = component.hydrate(
        self,
        domEmissions,
        attrs,
      );
      return { events: newEvents, domActions };
    },
  };
};

export type DeferGetter<Component extends NewComponent<any, any>> = <A>(
  selector: (events: GetEvents<Component>) => Observable<A>,
) => Observable<A>;

export type CycleComponent<Component extends NewComponent<any, any>> = (
  getEvent: DeferGetter<Component>,
) => GetAttributes<Component>;

declare const inferFnGenerics: <Fn extends (a: any) => unknown>(
  genFn: Fn,
) => Parameters<Fn>[0];

declare const genFn: <X extends { three: number }>(x: X) => void;

const test = inferFnGenerics(genFn);

export const mapParentComponent =
  <
    ParentFn extends (input: NewComponent<any, any>) => NewComponent<any, any>,
    NewAttributes extends Record<string, unknown> = {},
    NewEvents extends Record<string, unknown> = {},
    NewChildAttributes extends Record<string, unknown> = {},
    NewChildEvents extends Record<string, unknown> = {},
  >(
    parent: ParentFn,
    fn: (
      getEvent: <A>(
        selector: (
          events: Omit<GetEvents<ReturnType<ParentFn>>, "child">,
        ) => Observable<A>,
      ) => Observable<A>,
      newAttrs: NewAttributes,
      getChildEvent: <A>(
        selector: (events: GetEvents<Parameters<ParentFn>[0]>) => Observable<A>,
      ) => Observable<A>,
      newChildAttrs: NewChildAttributes,
    ) => {
      attrs: Omit<GetAttributes<ReturnType<ParentFn>>, "child">;
      childAttrs: GetAttributes<Parameters<ParentFn>[0]>;
      newEvents: NewEvents;
      newChildEvents: NewChildEvents;
    },
  ) =>
  <
    CA extends GetAttributes<Parameters<ParentFn>[0]>,
    CE extends GetEvents<Parameters<ParentFn>[0]>,
  >(
    child: NewComponent<CA, CE>,
  ): NewComponent<
    { child: CA; parent: NewAttributes },
    { child: CE; parent: NewEvents }
  > => {
    return {
      node: parent(child).node,
      hydrate: (self, domEmissions, newAttrs) => {
        const { events: childEvents, domActions: childDomActions } =
          child.hydrate(child.node, domEmissions, newAttrs);

        const { attrs, newEvents } = fn(
          (selector) => defer(() => selector(events)),
          newAttrs,
          newAttrs,
          childEvents,
        );
        const { events, domActions } = parent(child).hydrate(
          self,
          domEmissions,
          { ...attrs, ...newAttrs },
        );
        return {
          events: { ...newEvents, ...childEvents },
          domActions: merge(domActions, childDomActions),
        };
      },
    };
  };
