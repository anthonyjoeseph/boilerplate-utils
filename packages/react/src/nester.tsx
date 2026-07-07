import React, {
  FunctionComponent,
  ReactElement,
  ComponentProps,
  JSXElementConstructor,
} from "react";

export type UnionToIntersection<T> = (
  T extends any ? (x: T) => any : never
) extends (x: infer R) => any
  ? R
  : never;

const ReffyThing = ({
  ref,
}: {
  ref: React.Ref<HTMLInputElement>;
  otherinput: number;
  child?: { ref: React.Ref<HTMLInputElement> };
}) => <input ref={ref} />;

const ParentRefComp = ({
  allRefs,
}: {
  allRefs: {
    single: {
      ref: React.Ref<HTMLInputElement>;
      child: {
        ref: React.Ref<HTMLInputElement>;
      };
    };
    many: { ref: React.Ref<HTMLInputElement> }[];
  };
}) => (
  <>
    <ReffyThing otherinput={42} ref={allRefs.single.ref} />
    <ReffyThing otherinput={42} ref={allRefs.single.child.ref} />
    {allRefs.many.map(({ ref }) => (
      <ReffyThing otherinput={42} ref={ref} />
    ))}
  </>
);

type test = DeepRefObject<{
  single: {
    ref: React.Ref<HTMLInputElement>;
    otherinput: number;
    child: {
      ref: React.Ref<HTMLInputElement>;
    };
  };
  many: { ref: React.Ref<HTMLInputElement> }[];
}>;

type ExtractRef<A> = A extends React.RefObject<infer V> ? V : never;

type DeepRefObject<A> =
  A extends Array<unknown>
    ? DeepRefObject<A[number]>[]
    : A extends Record<string, unknown>
      ? {
          [K in keyof A as K extends "ref"
            ? K
            : A[K] extends Record<string, unknown>
              ? K
              : A[K] extends unknown[]
                ? K
                : never]: K extends "ref"
            ? ExtractRef<A[K]>
            : DeepRefObject<A[K]>;
        }
      : never;

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
