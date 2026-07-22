import type { FunctionComponent } from "react";
import React from "react";
import {
  useObservable,
  useObservableCallback,
  useObservableState
} from "observable-hooks";
import type { Observable } from "rxjs";
import { combineLatest, defer, noop, of } from "rxjs";
import * as R from "rxjs/operators";

export interface Prop<A> {
  obs?: Observable<A>;
  init: A;
}
export interface OptProp<A> {
  obs?: Observable<A>;
  init?: A;
}
export type ExtractProp<A extends Prop<any> | OptProp<any>> = A["init"];

export type Propify<A> = undefined extends A ? OptProp<A> : Prop<A>;

export type CycledProps<
  Props,
  NewProps extends Record<string, Prop<any> | OptProp<any>>,
  RetProps extends Partial<{ [K in keyof Props]: Propify<Props[K]> }>
> = {
  [
    K in keyof Props | keyof NewProps as K extends keyof RetProps ? never : K
  ]-?: K extends keyof Props
    ? Props[K]
    : K extends keyof NewProps
      ? ExtractProp<NewProps[K]>
      : never;
};

export const cycler =
  <
    Props,
    NewProps extends Record<string, Prop<any> | OptProp<any>>,
    RetProps extends Partial<{ [K in keyof Props]: Propify<Props[K]> }>
  >(
    component: (p: Props) => React.ReactNode,
    cycle: (
      newProps: NewProps,
      selectEvent: <Fn extends (a: any) => any>(
        selector: (
          props: Props & { [K in keyof NewProps]: ExtractProp<NewProps[K]> }
        ) => Fn
      ) => Observable<Parameters<Fn>[0]>
    ) => RetProps
  ): FunctionComponent<CycledProps<Props, NewProps, RetProps>> =>
  (externalProps) => {
    // A single tagged event bus. Callers only ever touch the derived
    // Observable (via `selectEvent`); the Subject stays hidden inside the hook.
    const [pushEvent, events$] = useObservableCallback<{
      key: PropertyKey;
      args: unknown[];
    }>((e$) => e$);

    // A live Observable of the outer props so each NewProp's `obs` reflects
    // changes across re-renders.
    const props$ = useObservable(
      (inputs$: Observable<[typeof externalProps]>) =>
        inputs$.pipe(R.map(([p]) => p)),
      [externalProps]
    );

    // Build the reactive graph once; the Observables it wires stay live.
    const graph = React.useMemo(() => {
      const newPropKeys = new Set<PropertyKey>();
      const selectedKeys = new Set<PropertyKey>();

      // `newProps` is lazily materialised: reading a key yields its Prop,
      // sourcing `init` from the mount-time value and `obs` from `props$`.
      const newProps = new Proxy(
        {},
        {
          get: (_t, key) => {
            newPropKeys.add(key);
            return {
              init: (externalProps as Record<PropertyKey, unknown>)[key],
              obs: props$.pipe(
                R.map((p) => (p as Record<PropertyKey, unknown>)[key]),
                R.distinctUntilChanged()
              )
            };
          }
        }
      ) as NewProps;

      const selectEvent = <Fn extends (a: any) => any>(
        selector: (props: Props) => Fn
      ): Observable<Parameters<Fn>[0]> => {
        // Identify the selected prop eagerly (so we know to wire an emitter)...
        let key: PropertyKey = "";
        selector(
          new Proxy(
            {},
            {
              get: (_t, k) => {
                key = k;
                return noop;
              }
            }
          ) as Props
        );
        selectedKeys.add(key);
        // ...but set up the filtered stream lazily, per subscription.
        return defer(() =>
          events$.pipe(
            R.filter((e) => e.key === key),
            R.map((e) => e.args[0] as Parameters<Fn>[0])
          )
        );
      };

      const retProps = cycle(newProps, selectEvent);

      // Collapse every cycled prop into one Observable of their current values.
      const entries = Object.entries(retProps) as [string, Prop<unknown>][];
      const initialCycled: Record<string, unknown> = {};
      for (const [k, rp] of entries) {
        initialCycled[k] = rp.init;
      }
      const cycled$: Observable<Record<string, unknown>> = entries.length
        ? combineLatest(
            Object.fromEntries(
              entries.map(([k, rp]) => [
                k,
                rp.obs ? rp.obs.pipe(R.startWith(rp.init)) : of(rp.init)
              ])
            ) as Record<string, Observable<unknown>>
          )
        : of<Record<string, unknown>>({});

      return { newPropKeys, selectedKeys, cycled$, initialCycled };
    }, []);

    const cycledValues = useObservableState(graph.cycled$, graph.initialCycled);

    // Assemble the wrapped component's props: pass-through outer props (minus
    // consumed NewProps), the cycled values, then event-emitter wrappers.
    const childProps: Record<PropertyKey, unknown> = {};
    for (const k of Object.keys(externalProps as object)) {
      if (!graph.newPropKeys.has(k)) {
        childProps[k] = (externalProps as Record<PropertyKey, unknown>)[k];
      }
    }
    Object.assign(childProps, cycledValues);
    for (const key of graph.selectedKeys) {
      const base = childProps[key];
      childProps[key] = (...args: unknown[]) => {
        pushEvent({ key, args });
        // Emit, then run whatever the cycle returned for this prop (e.g. noop).
        if (typeof base === "function") {
          (base as (...a: unknown[]) => unknown)(...args);
        }
      };
    }

    return React.createElement(
      component as FunctionComponent<Record<PropertyKey, unknown>>,
      childProps
    );
  };
