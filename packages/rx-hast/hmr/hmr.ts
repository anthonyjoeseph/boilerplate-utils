import * as r from "rxjs";
import { nums, letts, alphabet } from "./hmr-module";

// npm install --save-dev @types/parcel-env

const obs = r
  .concat(
    r.of("init"),
    r.EMPTY.pipe(r.delay(1000)),
    nums.pipe(
      r.withLatestFrom(letts),
      r.map(([num, lett]) => `${num}${lett}`)
    )
  )
  .pipe(
    r.map(String),
    r.tap((num) => {
      const node = document.getElementById("main");
      if (node) node.innerText = num;
    })
  );
obs.subscribe();
