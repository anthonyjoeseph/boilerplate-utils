import * as homepagets from "./home/page";
import * as tickerpagets from "./ticker/page";
import * as useridpagets from "./user/[userId]/page";

export {
  homepagets as "home",
  tickerpagets as "ticker",
  useridpagets as "user/[userId]"
};
