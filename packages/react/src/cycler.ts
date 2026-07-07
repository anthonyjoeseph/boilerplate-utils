import React, { ReactElement, FunctionComponent } from "react";
import { useObservableState } from "observable-hooks";
import { EMPTY, Observable, merge } from "rxjs";
import * as R from "rxjs/operators";

export type Prop<A> = { obs?: Observable<A>; init: A };
export type OptProp<A extends undefined> = {
  obs?: Observable<A>;
  init?: A;
};
export type ExtractProp<A extends Prop<any> | OptProp<any>> = A["init"];

export type Propify<A> = undefined extends A ? OptProp<A> : Prop<A>;

export type CycledProps<
  Props extends Record<string, unknown>,
  NewProps extends Record<string, Prop<any> | OptProp<any>>,
  RetProps extends Partial<{ [K in keyof Props]: Propify<Props[K]> }>,
> = {
  [K in keyof Props | keyof NewProps as K extends keyof RetProps
    ? never
    : K]-?: K extends keyof Props
    ? Props[K]
    : K extends keyof NewProps
      ? ExtractProp<NewProps[K]>
      : never;
};

export const cycler = <
  Props extends Record<string, unknown>,
  NewProps extends Record<string, Prop<any> | OptProp<any>>,
  RetProps extends Partial<{ [K in keyof Props]: Propify<Props[K]> }>,
>(
  component: (p: Props) => React.ReactNode,
  cycle: (
    selectEvent: <Fn extends (a: any) => any>(
      selector: (props: Props) => Fn,
    ) => Observable<Parameters<Fn>[0]>,
    newProps: NewProps,
  ) => RetProps,
): FunctionComponent<CycledProps<Props, NewProps, RetProps>> => {
  // implement 'selectEvent' using defer()
  return null;
};

type testProps = {
  plain: string;
  voidFn: (num: number) => void;
  retFn: (evt: boolean) => number;
};

declare const TestComp: (p: testProps) => React.ReactNode;

const TestCycled = cycler(
  TestComp,
  (newProps: { addedProp: Prop<(num: number) => void> }, evt) => {
    return {
      plain: {
        init: "1",
        obs: merge([
          evt((p) => p.voidFn).pipe(R.scan((acc) => acc + 1, 1)),
          newProps.addedProp.obs ?? EMPTY,
        ]).pipe(R.map(String)),
      },
    };
  },
);

const testEl = TestCycled({});
