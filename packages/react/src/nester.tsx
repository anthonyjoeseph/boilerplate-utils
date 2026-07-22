import type {
  FunctionComponent,
  ComponentProps,
  JSXElementConstructor,
  HTMLElementType,
  JSX
} from "react";
import React from "react";

export type UnionToIntersection<T> = (
  T extends any ? (x: T) => any : never
) extends (x: infer R) => any
  ? R
  : never;

export type OptionalKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? K : never;
}[keyof T];

export const narrowFn =
  <
    Fn extends (props: any) => any,
    const Keep extends OptionalKeys<Parameters<Fn>[0]>[]
  >(
    fn: Fn,
    // `Keep` is type-only: it narrows the returned function's props via the
    // mapped type below, but nothing at runtime needs the array's values.
    _keep: Keep
  ): ((narrowProps: {
    [
      K in keyof Parameters<Fn>[0] as {} extends Pick<Parameters<Fn>[0], K>
        ? K extends Keep[number]
          ? K
          : never
        : K
    ]: Parameters<Fn>[0][K];
  }) => ReturnType<Fn>) =>
  (narrowProps) =>
    fn(narrowProps) as any;

export const applyPartial =
  <
    Fn extends (props: any) => any,
    const Defaults extends Partial<Parameters<Fn>[0]>
  >(
    fn: Fn,
    defaultVals: Defaults
  ): ((narrowProps: {
    [
      K in keyof Parameters<Fn>[0] as undefined extends Defaults[K] ? K : never
    ]: Parameters<Fn>[0][K];
  }) => ReturnType<Fn>) =>
  (narrowProps) =>
    fn({ ...defaultVals, ...narrowProps }) as any;

export function primitive<T extends HTMLElementType>(
  type: T
): (props: JSX.IntrinsicElements[T]) => React.ReactNode {
  return (props: JSX.IntrinsicElements[T]) => React.createElement(type, props);
}

export const staticPrimitive = <T extends HTMLElementType>(
  type: T,
  staticProps: Partial<JSX.IntrinsicElements[T]>
): ((props: {
  children?: JSX.IntrinsicElements[T]["children"];
}) => React.ReactNode) =>
  narrowFn(
    // The generic mapped types can't be resolved concretely here, so assert
    // the post-`applyPartial` shape (only `children` survives narrowing).
    applyPartial(primitive(type), staticProps) as (props: {
      children?: JSX.IntrinsicElements[T]["children"];
    }) => React.ReactNode,
    ["children"]
  );

export const component =
  <
    Parent extends JSXElementConstructor<any>,
    Children extends JSXElementConstructor<any>[]
  >(
    parent: "children" extends keyof ComponentProps<Parent> ? Parent : never,
    children: Children
  ): FunctionComponent<
    Omit<ComponentProps<Parent>, "children"> &
      UnionToIntersection<
        Children[number] extends any ? ComponentProps<Children[number]> : never
      >
  > =>
  (props) =>
    React.createElement(
      parent as any,
      props,
      ...children.map((child, i) =>
        React.createElement(child as any, { ...props, key: i })
      )
    );

export const name =
  <Name extends string, Parent extends JSXElementConstructor<any>>(
    name: Name,
    parent: Parent
    // eslint-disable-next-line @typescript-eslint/consistent-indexed-object-style
  ): FunctionComponent<{ [K in Name]: ComponentProps<Parent> }> =>
  (props) =>
    React.createElement(parent as any, props[name]);

export const array =
  <Parent extends JSXElementConstructor<any>>(
    parent: Parent
  ): FunctionComponent<ComponentProps<Parent>[]> =>
  (propsList) =>
    React.createElement(
      React.Fragment,
      null,
      ...propsList.map((props, i) =>
        React.createElement(parent as any, { ...props, key: i })
      )
    );

export const discriminatedUnion =
  <
    Discriminator extends string,
    Items extends Record<string, JSXElementConstructor<any>>
  >(
    discriminator: Discriminator,
    options: Items
  ): FunctionComponent<
    {
      [K in keyof Items]: {
        [
          D in Discriminator | keyof ComponentProps<Items[K]>
        ]: D extends Discriminator ? K : ComponentProps<Items[K]>[D];
      };
    }[keyof Items]
  > =>
  (props) =>
    React.createElement(
      options[(props as any)[discriminator]] as any,
      props
    );

export const optional =
  <Parent extends JSXElementConstructor<any>>(
    parent: Parent
  ): FunctionComponent<ComponentProps<Parent> | undefined> =>
  (props) =>
    props === undefined ? null : React.createElement(parent as any, props);

export const c = component;
export const n = name;
export const a = array;
export const u = discriminatedUnion;
export const o = optional;
export const p = primitive;
export const sp = staticPrimitive;
