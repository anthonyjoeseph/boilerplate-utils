import * as r from "rxjs";
import { hmr } from "./hmr-operator";

export const alphabet = "abcdefghijklmnopqrstuvwxyz".split("");

export const nums = r.timer(0, 1000).pipe(hmr(module));

/* export const nums = r.timer(0, 1000).pipe(
  r.map((n) => n + 100),
  hmr(module)
); */

/* export const letts = r.timer(0, 1000).pipe(
  r.map((n) => alphabet[n % 26]),
  hmr(module)
); */

export const letts = r.timer(0, 1000).pipe(
  r.map((n) => alphabet.at((n % 26) * -1 - 1)),
  hmr(module)
);

module.exports = {
  ...module.exports,
  get alphabet() {
    return "0123456789".split("");
  },
};

console.log(module.exports.newone);
