import type { ComponentType } from "react";
import type { JsonValue } from "./json.js";

/**
 * Fixed ids shared between server and client. Never spelled out in user code —
 * `staticPage`/`dynamicPage` (in `@boilerplate-utils/server`) render into
 * {@link PAGE_ROOT_ID} and embed data under {@link PageData}; `hydratePage`
 * reads both back. That's what makes the hydration boundary enforced rather
 * than conventional: there is nowhere for the two sides to drift apart.
 */
export const PAGE_ROOT_ID = "__page";
const PAGE_DATA_ID = "__page_data";

/** Embeds loader data as JSON in the document. Renders nothing if `data` is undefined. */
export const PageData = <Data extends JsonValue | undefined>({
  data
}: {
  data: Data;
}): React.ReactElement | null =>
  data === undefined ? null : (
    <script
      id={PAGE_DATA_ID}
      type="application/json"
      // `<` must be escaped so a literal "</script>" in the data can't close the tag early.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</gu, "\\u003c")
      }}
    />
  );

/** Client-side counterpart to {@link PageData}. */
export const readPageData = <Data extends JsonValue | undefined>(): Data => {
  const el = document.getElementById(PAGE_DATA_ID);
  return el?.textContent
    ? (JSON.parse(el.textContent) as Data)
    : (undefined as Data);
};

/**
 * The entire body of a client entry module:
 *
 * ```ts
 * // App.tsx's sibling entry, generated or hand-written
 * import { hydratePage } from "@boilerplate-utils/react";
 * hydratePage(() => import("./App"));
 * ```
 *
 * Reads the loader data {@link PageData} embedded, and hydrates the module's
 * default export against it at {@link PAGE_ROOT_ID} — the same root
 * `staticPage`/`dynamicPage` rendered server-side.
 */
export const hydratePage = async <Props extends JsonValue | undefined>(
  loadApp: () => Promise<{ default: ComponentType<Props> }>
): Promise<void> => {
  const [{ hydrateRoot }, React, { default: App }] = await Promise.all([
    import("react-dom/client"),
    import("react"),
    loadApp()
  ]);

  const root = document.getElementById(PAGE_ROOT_ID);
  if (!root) {
    throw new Error(
      `hydratePage: no element with id="${PAGE_ROOT_ID}" found in the document`
    );
  }

  const data = readPageData<Props>();
  hydrateRoot(root, React.createElement(App as ComponentType<any>, data));
};
