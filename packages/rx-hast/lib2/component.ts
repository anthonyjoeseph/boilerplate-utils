import { type ReactNode } from "react";
import { type Observable } from "rxjs";
import { DomActions } from "./dom.js";
import { ShallowAnd } from "./util.js";

export type NewComponent<
  Attributes extends Record<string, unknown> = {},
  Events extends Record<string, unknown> = {}
> = {
  // hast-like static info, w/o reference to the DOM
  node: ReactNode;

  // 'self' includes an id, giving reference to the actual DOM
  hydrate: (
    self: ReactNode,
    domEmissions: DomActions,
    attrs: Attributes
  ) => { events: Events; domActions: DomActions };
};

export type GetAttributes<Component extends NewComponent<any, any>> =
  Parameters<Component["hydrate"]>[2];

export type GetEvents<Component extends NewComponent<any, any>> = ReturnType<
  Component["hydrate"]
>["events"];

export type UsableEventsForTag<
  Tag extends keyof JSX.IntrinsicElements,
  Keys extends Array<keyof JSX.IntrinsicElements[Tag]>
> = {
  [K in Keys[number]]: NonNullable<
    JSX.IntrinsicElements[Tag][K]
  > extends React.ReactEventHandler<any>
    ? Observable<Parameters<NonNullable<JSX.IntrinsicElements[Tag][K]>>[0]>
    : K extends "ref"
      ? () => JSX.IntrinsicElements[Tag]
      : never;
};

export type ComponentFn = {
  <
    Tag extends keyof JSX.IntrinsicElements,
    AttributeKeys extends Array<keyof JSX.IntrinsicElements[Tag]>,
    EventKeys extends Array<keyof JSX.IntrinsicElements[Tag] | "ref">,
    Child extends NewComponent<any, any>
  >(
    tag: Tag,
    dynamicInputs: AttributeKeys,
    outputs: EventKeys,
    staticInputs: JSX.IntrinsicElements[Tag],
    child: Child
  ): NewComponent<
    ShallowAnd<
      {
        [K in AttributeKeys[number]]-?: Observable<
          JSX.IntrinsicElements[Tag][K]
        >;
      },
      GetAttributes<Child>
    >,
    ShallowAnd<UsableEventsForTag<Tag, EventKeys>, GetEvents<Child>>
  >;
  <
    Tag extends keyof JSX.IntrinsicElements,
    AttributeKeys extends Array<keyof JSX.IntrinsicElements[Tag]>,
    EventKeys extends Array<keyof JSX.IntrinsicElements[Tag] | "ref">
  >(
    tag: Tag,
    dynamicInputs: AttributeKeys,
    outputs: EventKeys,
    staticInputs: JSX.IntrinsicElements[Tag]
  ): NewComponent<
    {
      [K in AttributeKeys[number]]-?: Observable<JSX.IntrinsicElements[Tag][K]>;
    },
    UsableEventsForTag<Tag, EventKeys>
  >;
};

export const component: ComponentFn = 3 as any;

export const childComponentBrand: unique symbol = Symbol();

export const parentComponent =
  <
    RequiredChildAttributes extends Record<string, unknown> = {},
    RequiredChildEvents extends Record<string, unknown> = {}
  >() =>
  <
    ParentAttributes extends {
      child: RequiredChildAttributes & { [childComponentBrand]: undefined };
    },
    ParentEvents extends {
      child: RequiredChildEvents & { [childComponentBrand]: undefined };
    }
  >(
    createFn: (
      child: NewComponent<
        RequiredChildAttributes & { [childComponentBrand]: undefined },
        RequiredChildEvents & { [childComponentBrand]: undefined }
      >
    ) => NewComponent<ParentAttributes, ParentEvents>
  ): (<
    ChildAttributes extends RequiredChildAttributes = RequiredChildAttributes,
    ChildEvents extends RequiredChildEvents = RequiredChildEvents
  >(
    child: NewComponent<ChildAttributes, ChildEvents>
  ) => NewComponent<
    {
      [K in keyof ParentAttributes]: K extends "child"
        ? ChildAttributes
        : ParentAttributes[K];
    },
    {
      [K in keyof ParentEvents]: K extends "child"
        ? ChildEvents
        : ParentEvents[K];
    }
  >) => {
    return createFn;
  };

/**
 * (attrs: Attributes) => [Events, Actions]
 *
 * Problem: can't iterate over a proxy, reduces flexibility
 * events often don't depend on attributes - this is usually unnecessary
 */

/**
 * [Events, (attrs: Attributes) => Actions]
 *
 * Problem: events sometimes have dependencies, e.g. DB or window
 *
 * can't use a proxy in these cases,
 * since dependencies are static & eagerly evaluated
 */

/**
 * (Dependencies) => [Events, (Attributes) => Actions]
 *
 * Problem: events sometimes depend on attributes, e.g. Modals, Tables
 * also, this is hugely more complicated than the other solutions
 */
