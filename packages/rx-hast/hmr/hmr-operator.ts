import * as r from "rxjs";
import { v4 as uuidv4 } from "uuid";

export const hmr = <A>(parentModule: NodeModule): r.MonoTypeOperatorFunction<A> => {
  const uniqueId = uuidv4();
  let currentObs = new r.Subject<r.Observable<A>>();
  let isReloaded = false;

  if (parentModule.hot) {
    parentModule.hot.dispose((data) => {
      const exportName = Object.entries(parentModule.exports).find(
        ([, value]) => (value as any)?.uniqueId === uniqueId
      )?.[0];
      if (exportName) {
        data[exportName] = currentObs;
      }
    });
    parentModule.hot.accept(() => {
      isReloaded = true;
      const exportName = Object.entries(parentModule.exports).find(
        ([, value]) => (value as any)?.uniqueId === uniqueId
      )?.[0];
      if (exportName) {
        currentObs = parentModule.hot?.data[exportName];
      }
    });
  }
  return (obs) => {
    setTimeout(() => {
      currentObs.next(obs);
    }, 0);
    const retval = currentObs.pipe(
      r.switchMap((obs) => obs),
      r.takeWhile(() => !isReloaded)
    );
    (retval as any).uniqueId = uniqueId;
    return retval;
  };
};
