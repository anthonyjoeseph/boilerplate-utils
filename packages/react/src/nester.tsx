import React, {
  FunctionComponent,
  ReactElement,
  ComponentProps,
  JSXElementConstructor,
  HTMLElementType,
  DetailedReactHTMLElement,
  HTMLAttributes,
  InputHTMLAttributes,
} from "react";

export type UnionToIntersection<T> = (
  T extends any ? (x: T) => any : never
) extends (x: infer R) => any
  ? R
  : never;

export const narrowFn = <
  Fn extends (props: Record<string, unknown>) => any,
  const Keep extends (keyof Parameters<Fn>[0])[],
>(
  fn: Fn,
  keep: Keep,
): ((narrowProps: {
  [K in Keep[number]]: Parameters<Fn>[0][K];
}) => ReturnType<Fn>) => null;

const thing = narrowFn(primitive("input"), ["onClick", "value"]);

export const element = <Children extends JSXElementConstructor<any>[]>(
  el: ReactElement,
  children: Children,
): FunctionComponent<
  UnionToIntersection<
    Children[number] extends any ? ComponentProps<Children[number]> : never
  >
> => null;

export const component = <
  Parent extends JSXElementConstructor<any>,
  StaticProps extends Partial<ComponentProps<Parent>>,
  Children extends JSXElementConstructor<any>[],
>(
  parent: Parent,
  staticProps: StaticProps,
  children: Children,
): FunctionComponent<
  {
    [K in keyof ComponentProps<Parent> as K extends keyof StaticProps
      ? undefined extends StaticProps[K]
        ? K
        : never
      : K]: ComponentProps<Parent>[K];
  } & UnionToIntersection<
    Children[number] extends any ? ComponentProps<Children[number]> : never
  >
> => null;

export const name = <
  Name extends string,
  Parent extends JSXElementConstructor<any>,
>(
  name: Name,
  parent: Parent,
): FunctionComponent<{ [K in Name]: ComponentProps<Parent> }> => null;

export const array = <Parent extends JSXElementConstructor<any>>(
  parent: Parent,
): FunctionComponent<ComponentProps<Parent>[]> => null;

export const discriminatedUnion = <
  Discriminator extends string,
  Items extends Record<string, JSXElementConstructor<any>>,
>(
  discriminator: Discriminator,
  options: Items,
): FunctionComponent<
  {
    [K in keyof Items]: {
      [D in
        | Discriminator
        | keyof ComponentProps<Items[K]>]: D extends Discriminator
        ? K
        : ComponentProps<Items[K]>[D];
    };
  }[keyof Items]
> => null;

export const optional = <Parent extends JSXElementConstructor<any>>(
  parent: Parent,
): FunctionComponent<ComponentProps<Parent> | undefined> => null;

export const e = element;
export const c = component;
export const n = name;
export const a = array;
export const u = discriminatedUnion;
export const o = optional;
export const p = primitive;

declare const TestCompA: FunctionComponent<{ a?: number; other: string }>;
declare const TestCompB: FunctionComponent<{ b: string }>;
declare const TestCompC: FunctionComponent<{ c: boolean }>;

const TestElement = element(<a />, [TestCompA, TestCompB]);

const TestComponent = component(TestCompA, { a: 3 }, [TestCompB, TestCompC]);

const TestName = name("theTest", TestCompA);

const TestArray = array(TestCompA);

const TestDisc = discriminatedUnion("type", {
  thing1: TestCompA,
  thing2: TestCompB,
});

const TestOpt = optional(TestCompA);

const TestAll = e(<div />, [n("a", TestCompA), TestCompB]);

// Overload for <input> — uses InputHTMLAttributes and HTMLInputElement
export function primitive(
  type: "input",
): (
  props: InputHTMLAttributes<HTMLInputElement>,
) => DetailedReactHTMLElement<
  InputHTMLAttributes<HTMLInputElement>,
  HTMLInputElement
>;

// General overload for all other HTML elements
export function primitive<T extends HTMLElementType>(
  type: T,
): (
  props: HTMLAttributes<HTMLElement>,
) => DetailedReactHTMLElement<HTMLAttributes<HTMLElement>, HTMLElement>;

// Implementation
export function primitive<T extends HTMLElementType>(type: T) {
  return (
    props: T extends "input"
      ? InputHTMLAttributes<HTMLInputElement>
      : HTMLAttributes<HTMLElement>,
  ) => React.createElement(type, props);
}
