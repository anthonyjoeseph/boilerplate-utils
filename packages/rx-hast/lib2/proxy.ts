import { Observable, ObservedValueOf, type ObservableInput } from "rxjs";

export type DeepProxy<A> = A extends Record<string, unknown>
  ? {
    [K in keyof A]: DeepProxy<A[K]>
  }
  : () => A;

export const proxify = <Input>(
  fn: <A>(selector: (i: Input) => A) => A,
): DeepProxy<Input> => {
  const recurse = (path: string[]) =>
    new Proxy<DeepProxy<Input>>({} as unknown as DeepProxy<Input>, {
      get: (_target, property, _receiver) => {
        return recurse([...path, property as string]);
      },
      apply: (_target, _thisArg, _argArray) => {
        return fn((i) => path.reduce((acc, cur) => (acc as Record<string, unknown>)[cur], i as unknown));
      },
    });
  return recurse([]);
};

export type DeepProxyObservable<A> = A extends Record<string, unknown>
  ? {
    [K in keyof A]: DeepProxyObservable<A[K]>
  }
  : A extends Observable<unknown>
  ? () => A
  : never

export const proxifyObservable = proxify as <Input>(
  fn: <A>(selector: (i: Input) => Observable<A>) => Observable<A>,
) => DeepProxyObservable<Input>