import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from "react";
import { z } from "zod";

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

/** Location of a field within the schema, e.g. `["employee", "allergies", 0]`. */
export type FieldPath = readonly (string | number)[];

/**
 * Dotted rendering of a {@link FieldPath}, used as the `name` attribute and as
 * the key for per-path overrides: `"employee.allergies.0"`.
 *
 * Overrides may use `*` to match any single segment (`"allergies.*"`) or `**`
 * to match any remaining segments (`"employee.**"`).
 */
export type FieldPathKey = string;

export interface FieldHandle<Value> {
  getValue: () => Value | undefined;
  setValue: (value: Value | undefined) => void;
  focus: () => void;
  /** Scroll target for `scrollToFirstError`. */
  element: HTMLElement | null;
}

export interface FormHandle<Values> {
  getValues: () => Values;
  setValues: (values: Values) => void;
  /** Runs the schema, paints errors, returns the parse result. */
  validate: () => z.ZodSafeParseResult<Values>;
  /** Same as clicking submit, including scroll-to-error behaviour. */
  submit: () => void;
  reset: (values?: Values) => void;
  /** Server-side / async errors, keyed by dotted path. `""` targets the form. */
  setErrors: (errors: Record<FieldPathKey, readonly string[]>) => void;
  focusFirstError: () => void;
}

/** Props shared by every leaf field, panel, and array panel. */
export interface NodeProps {
  /** Dotted path — suitable for the `name` attribute. */
  name: FieldPathKey;
  path: FieldPath;
  /** From `.meta({ title })`, else `.description`, else a title-cased key. */
  label: string | undefined;
  description: string | undefined;
  /** False when the schema node is `.optional()` / `.nullish()` / has a default. */
  required: boolean;
  disabled: boolean;
  /** Nesting depth, 0 at the root. Handy for heading levels / indentation. */
  depth: number;
  /** Messages for this exact node (not descendants). */
  errors: readonly string[];
}

export type FieldProps<
  Value,
  Schema extends z.ZodType = z.ZodType
> = NodeProps & {
  schema: Schema;
  ref: React.Ref<FieldHandle<Value>>;
} & (
    | {
        controlled: true;
        value: Value | undefined;
        onChange: (value: Value | undefined) => void;
        onBlur: () => void;
      }
    | { controlled: false; defaultValue: Value | undefined }
  );

/** A `z.object()` renders as a panel wrapping its children. */
export interface PanelProps extends NodeProps {
  children: React.ReactNode;
  /** Errors from anywhere beneath this panel, for a per-panel summary. */
  descendantErrors: readonly FormError[];
}

/** One entry inside an array panel. */
export interface ArrayItemProps {
  index: number;
  path: FieldPath;
  children: React.ReactNode;
  canRemove: boolean;
  onRemove: () => void;
  /** Present only when `arrays.reorderable` is on. */
  onMove?: (toIndex: number) => void;
}

/** A `z.array()` renders as a panel with add/remove controls. */
export interface ArrayPanelProps extends NodeProps {
  items: readonly ArrayItemProps[];
  /** False once `.max(n)` is reached. */
  canAdd: boolean;
  /** Appends a fresh item built from the element schema's defaults. */
  onAdd: () => void;
  minItems: number | undefined;
  maxItems: number | undefined;
  descendantErrors: readonly FormError[];
}

/** A `z.union()` / `z.discriminatedUnion()` renders as a variant picker. */
export interface UnionPanelProps extends NodeProps {
  options: readonly { key: string; label: string }[];
  selected: string | undefined;
  onSelect: (key: string) => void;
  /** The rendered subtree for the currently selected variant. */
  children: React.ReactNode;
}

export interface FormError {
  path: FieldPath;
  name: FieldPathKey;
  /** Label of the offending field, for readable summaries. */
  label: string | undefined;
  message: string;
  issue: z.core.$ZodIssue | undefined;
}

/** Rendered above and/or below the fields when `errors.summary` is on. */
export interface ErrorSummaryProps {
  errors: readonly FormError[];
  /** Focuses + scrolls to the offending field. */
  onSelect: (error: FormError) => void;
}

/** Rendered beneath a field when `errors.inline` is on. */
export interface ErrorListProps {
  name: FieldPathKey;
  errors: readonly string[];
}

/**
 * Zod type -> React component. Keys match zod v4's `def.type` discriminator.
 * Wrappers (`optional`, `nullable`, `default`, etc.) are unwrapped before
 * dispatch — map the inner type.
 */
export interface FieldComponents {
  string: React.FC<FieldProps<string, z.ZodString>>;
  number: React.FC<FieldProps<number, z.ZodNumber>>;
  bigint: React.FC<FieldProps<bigint, z.ZodBigInt>>;
  boolean: React.FC<FieldProps<boolean, z.ZodBoolean>>;
  date: React.FC<FieldProps<Date, z.ZodDate>>;
  enum: React.FC<FieldProps<string | number, z.ZodEnum>>;
  literal: React.FC<FieldProps<z.core.util.Literal, z.ZodLiteral>>;
  file: React.FC<FieldProps<File, z.ZodFile>>;
  /** `z.record()` — key/value pair editor. */
  record: React.FC<FieldProps<Record<string, unknown>, z.ZodRecord>>;
  /** Anything the map doesn't cover (`any`, `unknown`, custom, …). */
  fallback: React.FC<FieldProps<unknown>>;
}

/** Structural components — the recursion's frame rather than its leaves. */
export interface LayoutComponents {
  /** `z.object()` */
  panel: React.FC<PanelProps>;
  /** `z.array()` */
  arrayPanel: React.FC<ArrayPanelProps>;
  /** `z.union()` / `z.discriminatedUnion()` */
  unionPanel: React.FC<UnionPanelProps>;
  /** Wraps every leaf: label + control + inline errors. */
  fieldWrapper: React.FC<NodeProps & { children: React.ReactNode }>;
  errorSummary: React.FC<ErrorSummaryProps>;
  errorList: React.FC<ErrorListProps>;
  form: React.FC<{
    children: React.ReactNode;
    onSubmit: React.FormEventHandler<HTMLFormElement>;
  }>;
  submitButton: React.FC<{ disabled: boolean; submitting: boolean }>;
}

export type ValidationTrigger = "change" | "blur" | "submit";

export interface ZodFormOptions<Schema extends z.ZodType> {
  /** Overrides merged over {@link defaultFieldComponents}. */
  components?: Partial<FieldComponents>;
  /** Overrides merged over {@link defaultLayoutComponents}. */
  layout?: Partial<LayoutComponents>;
  /**
   * Per-path escape hatch, checked before the type map. Supports `*` and `**`
   * wildcards; the most specific match wins.
   */
  overrides?: Record<FieldPathKey, React.FC<FieldProps<any, any>>>;
  /** Seeds the form. Merged under the schema's own `.default()` values. */
  initialValues?: DeepPartial<z.infer<Schema>>;
  /**
   * `"controlled"` re-renders on every keystroke and gives fields
   * `value`/`onChange`; `"uncontrolled"` keeps values in refs and only reads
   * them on validate/submit. Default: `"uncontrolled"`.
   */
  mode?: "controlled" | "uncontrolled";
  validation?: {
    /** Default: `["submit"]`. */
    on?: readonly ValidationTrigger[];
    /** Triggers used after the first failed submit. Default: `["change"]`. */
    revalidateOn?: readonly ValidationTrigger[];
    /** Debounce for `"change"`, in ms. Default: 0. */
    debounceMs?: number;
  };
  errors?: {
    /** Render messages beneath each field. Default: `true`. */
    inline?: boolean;
    /** Also render a combined list. Default: `"none"`. */
    summary?: "none" | "top" | "bottom" | "both";
    /** Map a zod issue to display text (i18n, friendlier copy, …). */
    format?: (issue: z.core.$ZodIssue, path: FieldPath) => string;
  };
  /** On failed submit, scroll the first offending field into view. */
  scrollToFirstError?: boolean | ScrollIntoViewOptions;
  /** Also `.focus()` that field. Default: `true`. */
  focusFirstError?: boolean;
  arrays?: {
    /** Show move up/down controls. Default: `false`. */
    reorderable?: boolean;
    /** Build a new element; defaults to the element schema's defaults. */
    newItem?: (path: FieldPath) => unknown;
  };
  /** Override the derived label for any node. */
  label?: (path: FieldPath, schema: z.ZodType) => string | undefined;
  /** Warn on unmapped types instead of silently falling back. Default: `false`. */
  strictComponentMap?: boolean;
}

export type DeepPartial<T> = T extends readonly (infer U)[]
  ? readonly DeepPartial<U>[]
  : T extends Date | File
    ? T
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;

export interface ZodFormProps<Values> {
  /** Called with parsed, schema-typed values once validation passes. */
  onSubmit: (values: Values) => void | Promise<void>;
  onInvalid?: (errors: readonly FormError[]) => void;
  /** Fires on every change in controlled mode; ignored when uncontrolled. */
  onChange?: (values: DeepPartial<Values>) => void;
  /** Overrides `options.initialValues` per-render. */
  initialValues?: DeepPartial<Values>;
  disabled?: boolean;
  ref?: React.Ref<FormHandle<Values>>;
  /** Replaces the default submit button when supplied. */
  children?: React.ReactNode;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

// Cast helpers: zod v4 unwrap methods return z.$ZodType (the internal base),
// not z.ZodType (the public subclass). We coerce back since all our runtime
// instanceof checks target the concrete subclasses, not the base class itself.
const asZodType = (x: unknown) => x as z.ZodType;

function unwrap(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodOptional)
    return unwrap(asZodType(schema.unwrap()));
  if (schema instanceof z.ZodNullable)
    return unwrap(asZodType(schema.unwrap()));
  if (schema instanceof z.ZodDefault)
    return unwrap(asZodType(schema.removeDefault()));
  if (schema instanceof z.ZodReadonly)
    return unwrap(asZodType((schema as any).unwrap()));
  if (schema instanceof z.ZodCatch)
    return unwrap(asZodType((schema as any).removeCatch()));
  if (schema instanceof z.ZodPipe)
    return unwrap(asZodType((schema as z.ZodPipe<any, any>).in));
  if (schema instanceof z.ZodLazy)
    return unwrap(asZodType((schema as any)._def?.getter?.()));
  return schema;
}

function isRequired(schema: z.ZodType): boolean {
  return !(
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault
  );
}

function titleCase(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function deriveLabel(
  schema: z.ZodType,
  key: string | undefined,
  labelFn: ZodFormOptions<any>["label"],
  path: FieldPath
): string | undefined {
  if (labelFn) {
    const custom = labelFn(path, schema);
    if (custom !== undefined) return custom;
  }
  const meta = (schema as any).meta?.() as { title?: string } | undefined;
  if (typeof meta?.title === "string") return meta.title;
  if (typeof schema.description === "string") return schema.description;
  return key ? titleCase(key) : undefined;
}

function pathToKey(path: FieldPath): FieldPathKey {
  return path.join(".");
}

function flatToNested(flat: Map<string, unknown>): unknown {
  const root: Record<string, unknown> = {};
  for (const [dotPath, value] of flat) {
    const parts = dotPath.split(".");
    let cur: any = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      const nextPart = parts[i + 1];
      if (part === undefined) continue;
      if (cur[part] === undefined) {
        cur[part] = nextPart !== undefined && /^\d+$/.test(nextPart) ? [] : {};
      }
      cur = cur[part];
    }
    const last = parts[parts.length - 1];
    if (last !== undefined) cur[last] = value;
  }
  return root;
}

function getAtPath(obj: unknown, path: FieldPath): unknown {
  let cur: any = obj;
  for (const key of path) {
    if (cur == null) return undefined;
    cur = cur[key];
  }
  return cur;
}

function setAtPath(obj: unknown, path: FieldPath, value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path as [string | number, ...(string | number)[]];
  if (typeof head === "number") {
    const arr = Array.isArray(obj) ? [...obj] : [];
    arr[head] = setAtPath(arr[head], rest, value);
    return arr;
  }
  const rec: Record<string, unknown> =
    obj != null && typeof obj === "object" && !Array.isArray(obj)
      ? { ...(obj as Record<string, unknown>) }
      : {};
  rec[head] = setAtPath(rec[head], rest, value);
  return rec;
}

function buildErrorMap(
  error: z.ZodError,
  fmt?: (issue: z.core.$ZodIssue, path: FieldPath) => string
): Record<string, readonly string[]> {
  const map: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path as FieldPath;
    const name = pathToKey(path);
    const msg = fmt ? fmt(issue as z.core.$ZodIssue, path) : issue.message;
    (map[name] ??= []).push(msg);
  }
  return map;
}

function getDescendantErrors(
  errors: Record<string, readonly string[]>,
  prefix: string
): FormError[] {
  const result: FormError[] = [];
  for (const [name, msgs] of Object.entries(errors)) {
    if (prefix === "" || name === prefix || name.startsWith(prefix + ".")) {
      const path: (string | number)[] = name
        ? name.split(".").map((s) => (/^\d+$/.test(s) ? parseInt(s, 10) : s))
        : [];
      for (const msg of msgs) {
        result.push({
          path,
          name,
          label: undefined,
          message: msg,
          issue: undefined
        });
      }
    }
  }
  return result;
}

function getSchemaDefault(schema: z.ZodType): unknown {
  const r = schema.safeParse(undefined);
  return r.success ? r.data : undefined;
}

function buildInitialValues(schema: z.ZodType, initial: unknown): unknown {
  const inner = unwrap(schema);
  if (inner instanceof z.ZodObject) {
    const shape = (inner as z.ZodObject<z.ZodRawShape>).shape;
    const result: Record<string, unknown> = {};
    for (const [key, fieldSchema] of Object.entries(shape)) {
      result[key] = buildInitialValues(
        asZodType(fieldSchema),
        (initial as any)?.[key]
      );
    }
    return result;
  }
  if (inner instanceof z.ZodArray) {
    const arr = Array.isArray(initial) ? initial : [];
    const element = (inner as z.ZodArray<z.ZodType>).element;
    return (arr as unknown[]).map((item) => buildInitialValues(element, item));
  }
  if (initial !== undefined) return initial;
  return getSchemaDefault(schema);
}

function getArrayConstraints(schema: z.ZodArray<z.ZodType>): {
  min: number | undefined;
  max: number | undefined;
} {
  let min: number | undefined;
  let max: number | undefined;
  for (const check of (schema._def as any).checks ?? []) {
    const def = (check as any)._zod?.def;
    if (def?.check === "min_length") min = def.minimum as number;
    if (def?.check === "max_length") max = def.maximum as number;
  }
  return { min, max };
}

function matchesOverride(pattern: string, name: string): boolean {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\*/g, "*")
    .replace(/\*\*/g, "\x00")
    .replace(/\*/g, "[^.]+")
    .replace(/\x00/g, ".+");
  return new RegExp(`^${escaped}$`).test(name);
}

function resolveComponent(
  schema: z.ZodType,
  name: FieldPathKey,
  opts: ZodFormOptions<any>,
  fields: FieldComponents
): React.FC<any> {
  if (opts.overrides) {
    for (const [pattern, comp] of Object.entries(opts.overrides)) {
      if (matchesOverride(pattern, name)) return comp;
    }
  }
  if (schema instanceof z.ZodString) return fields.string;
  if (schema instanceof z.ZodNumber) return fields.number;
  if (schema instanceof z.ZodBigInt) return fields.bigint;
  if (schema instanceof z.ZodBoolean) return fields.boolean;
  if (schema instanceof z.ZodDate) return fields.date;
  if (schema instanceof z.ZodEnum) return fields.enum as React.FC<any>;
  if (schema instanceof z.ZodLiteral) return fields.literal as React.FC<any>;
  if (schema instanceof z.ZodFile) return fields.file;
  if (schema instanceof z.ZodRecord) return fields.record as React.FC<any>;
  return fields.fallback;
}

/* -------------------------------------------------------------------------- */
/* Internal context                                                            */
/* -------------------------------------------------------------------------- */

interface InternalCtx {
  errors: Record<string, readonly string[]>;
  disabled: boolean;
  mode: "controlled" | "uncontrolled";
  opts: ZodFormOptions<any>;
  fields: FieldComponents;
  layout: LayoutComponents;
  register: (name: string, handle: FieldHandle<unknown>) => void;
  unregister: (name: string) => void;
  getValue: (path: FieldPath) => unknown;
  onChange: (path: FieldPath, value: unknown) => void;
  onBlur: (path: FieldPath) => void;
  initialValues: unknown;
}

const FormCtx = createContext<InternalCtx | null>(null);

// Exported so consumers can build components that plug into a zodForm context
export function useFormCtx(): InternalCtx {
  const ctx = useContext(FormCtx);
  if (!ctx)
    throw new Error(
      "zodForm: must be rendered inside a generated form component"
    );
  return ctx;
}

/* -------------------------------------------------------------------------- */
/* Default field components                                                    */
/* -------------------------------------------------------------------------- */

// Shared helper: wire a DOM ref to the FieldHandle imperative API
function useFieldHandle<El extends HTMLElement, Value>(
  elRef: React.RefObject<El | null>,
  ref: React.Ref<FieldHandle<Value>>,
  getValue: () => Value | undefined,
  setValue: (v: Value | undefined) => void
) {
  useImperativeHandle(ref, () => ({
    getValue,
    setValue,
    focus: () => elRef.current?.focus(),
    get element(): HTMLElement | null {
      return elRef.current;
    }
  }));
}

const StringField: React.FC<FieldProps<string, z.ZodString>> = (props) => {
  const el = useRef<HTMLInputElement>(null);
  useFieldHandle(
    el,
    props.ref,
    () => el.current?.value,
    (v) => {
      if (el.current) el.current.value = v ?? "";
    }
  );
  if (props.controlled) {
    return (
      <input
        ref={el}
        type="text"
        value={props.value ?? ""}
        onChange={(e) => props.onChange(e.target.value)}
        onBlur={props.onBlur}
      />
    );
  }
  return <input ref={el} type="text" defaultValue={props.defaultValue ?? ""} />;
};

const NumberField: React.FC<FieldProps<number, z.ZodNumber>> = (props) => {
  const el = useRef<HTMLInputElement>(null);
  useFieldHandle(
    el,
    props.ref,
    () => {
      const v = el.current?.value;
      return v === "" || v === undefined ? undefined : Number(v);
    },
    (v) => {
      if (el.current) el.current.value = v === undefined ? "" : String(v);
    }
  );
  if (props.controlled) {
    return (
      <input
        ref={el}
        type="number"
        value={props.value === undefined ? "" : props.value}
        onChange={(e) =>
          props.onChange(
            e.target.value === "" ? undefined : Number(e.target.value)
          )
        }
        onBlur={props.onBlur}
      />
    );
  }
  return (
    <input
      ref={el}
      type="number"
      defaultValue={props.defaultValue === undefined ? "" : props.defaultValue}
    />
  );
};

const BigIntField: React.FC<FieldProps<bigint, z.ZodBigInt>> = (props) => {
  const el = useRef<HTMLInputElement>(null);
  useFieldHandle(
    el,
    props.ref,
    () => {
      try {
        return el.current?.value ? BigInt(el.current.value) : undefined;
      } catch {
        return undefined;
      }
    },
    (v) => {
      if (el.current) el.current.value = v === undefined ? "" : String(v);
    }
  );
  const toStr = (v: bigint | undefined) => (v === undefined ? "" : String(v));
  if (props.controlled) {
    return (
      <input
        ref={el}
        type="text"
        inputMode="numeric"
        value={toStr(props.value)}
        onChange={(e) => {
          try {
            props.onChange(
              e.target.value === "" ? undefined : BigInt(e.target.value)
            );
          } catch {
            props.onChange(undefined);
          }
        }}
        onBlur={props.onBlur}
      />
    );
  }
  return (
    <input
      ref={el}
      type="text"
      inputMode="numeric"
      defaultValue={toStr(props.defaultValue)}
    />
  );
};

const BooleanField: React.FC<FieldProps<boolean, z.ZodBoolean>> = (props) => {
  const el = useRef<HTMLInputElement>(null);
  useFieldHandle(
    el,
    props.ref,
    () => el.current?.checked,
    (v) => {
      if (el.current) el.current.checked = v ?? false;
    }
  );
  if (props.controlled) {
    return (
      <input
        ref={el}
        type="checkbox"
        checked={props.value ?? false}
        onChange={(e) => props.onChange(e.target.checked)}
        onBlur={props.onBlur}
      />
    );
  }
  return (
    <input
      ref={el}
      type="checkbox"
      defaultChecked={props.defaultValue ?? false}
    />
  );
};

const dateToInputStr = (d: Date | undefined): string => {
  if (!d || isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
};

const inputStrToDate = (s: string): Date | undefined => {
  if (!s) return undefined;
  const d = new Date(s + "T00:00:00");
  return isNaN(d.getTime()) ? undefined : d;
};

const DateField: React.FC<FieldProps<Date, z.ZodDate>> = (props) => {
  const el = useRef<HTMLInputElement>(null);
  useFieldHandle(
    el,
    props.ref,
    () => inputStrToDate(el.current?.value ?? ""),
    (v) => {
      if (el.current) el.current.value = dateToInputStr(v);
    }
  );
  if (props.controlled) {
    return (
      <input
        ref={el}
        type="date"
        value={dateToInputStr(props.value)}
        onChange={(e) => props.onChange(inputStrToDate(e.target.value))}
        onBlur={props.onBlur}
      />
    );
  }
  return (
    <input
      ref={el}
      type="date"
      defaultValue={dateToInputStr(props.defaultValue)}
    />
  );
};

const EnumField: React.FC<FieldProps<string | number, z.ZodEnum>> = (props) => {
  const el = useRef<HTMLSelectElement>(null);
  const options = (props.schema as any).options as readonly (string | number)[];
  useFieldHandle(
    el,
    props.ref,
    () => el.current?.value || undefined,
    (v) => {
      if (el.current) el.current.value = v === undefined ? "" : String(v);
    }
  );
  const opts = options.map((o) => (
    <option key={String(o)} value={String(o)}>
      {String(o)}
    </option>
  ));
  if (props.controlled) {
    return (
      <select
        ref={el}
        value={props.value === undefined ? "" : String(props.value)}
        onChange={(e) => props.onChange(e.target.value || undefined)}
        onBlur={props.onBlur}
      >
        <option value="">—</option>
        {opts}
      </select>
    );
  }
  return (
    <select
      ref={el}
      defaultValue={
        props.defaultValue === undefined ? "" : String(props.defaultValue)
      }
    >
      <option value="">—</option>
      {opts}
    </select>
  );
};

const LiteralField: React.FC<FieldProps<z.core.util.Literal, z.ZodLiteral>> = (
  props
) => {
  const el = useRef<HTMLInputElement>(null);
  const val = props.schema.value;
  // Literals are display-only — the value comes from the schema, not user input
  useFieldHandle(
    el,
    props.ref,
    () => val,
    () => undefined
  );
  return <input ref={el} type="text" readOnly value={String(val)} />;
};

const FileField: React.FC<FieldProps<File, z.ZodFile>> = (props) => {
  const el = useRef<HTMLInputElement>(null);
  useFieldHandle(
    el,
    props.ref,
    () => el.current?.files?.[0],
    (v) => {
      if (!v && el.current) el.current.value = "";
    }
  );
  return (
    <input
      ref={el}
      type="file"
      onChange={
        props.controlled
          ? (e) => props.onChange(e.target.files?.[0])
          : undefined
      }
      onBlur={props.controlled ? props.onBlur : undefined}
    />
  );
};

const RecordField: React.FC<
  FieldProps<Record<string, unknown>, z.ZodRecord>
> = (props) => {
  const el = useRef<HTMLTextAreaElement>(null);
  const parse = (s: string): Record<string, unknown> | undefined => {
    try {
      return JSON.parse(s) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  };
  const toStr = (v: Record<string, unknown> | undefined) =>
    v === undefined ? "" : JSON.stringify(v, null, 2);
  useFieldHandle(
    el,
    props.ref,
    () => parse(el.current?.value ?? ""),
    (v) => {
      if (el.current) el.current.value = toStr(v);
    }
  );
  if (props.controlled) {
    return (
      <textarea
        ref={el}
        value={toStr(props.value)}
        onChange={(e) => props.onChange(parse(e.target.value))}
        onBlur={props.onBlur}
        rows={4}
        style={{ fontFamily: "monospace" }}
      />
    );
  }
  return (
    <textarea
      ref={el}
      defaultValue={toStr(props.defaultValue)}
      rows={4}
      style={{ fontFamily: "monospace" }}
    />
  );
};

const FallbackField: React.FC<FieldProps<unknown>> = (props) => {
  const el = useRef<HTMLTextAreaElement>(null);
  const parse = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return s || undefined;
    }
  };
  const toStr = (v: unknown) => (v === undefined ? "" : JSON.stringify(v));
  useFieldHandle(
    el,
    props.ref,
    () => parse(el.current?.value ?? ""),
    (v) => {
      if (el.current) el.current.value = toStr(v);
    }
  );
  if (props.controlled) {
    return (
      <textarea
        ref={el}
        value={toStr(props.value)}
        onChange={(e) => props.onChange(parse(e.target.value))}
        onBlur={props.onBlur}
      />
    );
  }
  return <textarea ref={el} defaultValue={toStr(props.defaultValue)} />;
};

/**
 * Unstyled, dependency-free components covering every key above — semantic HTML
 * with `data-form` attributes for styling. `z.enum()` becomes a `<select>`,
 * `z.date()` a `<input type="date">`, `z.boolean()` a checkbox, and so on.
 *
 * Meant as a starting point: spread it and replace the pieces you care about.
 */
export const defaultFieldComponents: FieldComponents = {
  string: StringField,
  number: NumberField,
  bigint: BigIntField,
  boolean: BooleanField,
  date: DateField,
  enum: EnumField as React.FC<FieldProps<string | number, z.ZodEnum>>,
  literal: LiteralField as React.FC<
    FieldProps<z.core.util.Literal, z.ZodLiteral>
  >,
  file: FileField,
  record: RecordField as React.FC<
    FieldProps<Record<string, unknown>, z.ZodRecord>
  >,
  fallback: FallbackField
};

/* -------------------------------------------------------------------------- */
/* Default layout components                                                   */
/* -------------------------------------------------------------------------- */

const DefaultPanel: React.FC<PanelProps> = ({ label, children }) => (
  <fieldset
    data-form="panel"
    style={{ border: "1px solid #ccc", padding: "1rem", marginBottom: "1rem" }}
  >
    {label && <legend data-form="panel-legend">{label}</legend>}
    {children}
  </fieldset>
);

const DefaultArrayPanel: React.FC<ArrayPanelProps> = ({
  label,
  items,
  canAdd,
  onAdd
}) => (
  <fieldset
    data-form="array-panel"
    style={{ border: "1px solid #ccc", padding: "1rem", marginBottom: "1rem" }}
  >
    {label && <legend data-form="array-legend">{label}</legend>}
    {items.map((item) => (
      <div
        key={item.index}
        data-form="array-item"
        style={{ position: "relative", marginBottom: "0.5rem" }}
      >
        {item.children}
        {item.canRemove && (
          <button
            type="button"
            data-form="array-remove"
            onClick={item.onRemove}
            aria-label="Remove item"
          >
            −
          </button>
        )}
      </div>
    ))}
    {canAdd && (
      <button type="button" data-form="array-add" onClick={onAdd}>
        + Add
      </button>
    )}
  </fieldset>
);

const DefaultUnionPanel: React.FC<UnionPanelProps> = ({
  options,
  selected,
  onSelect,
  children
}) => (
  <div data-form="union-panel">
    <select value={selected ?? ""} onChange={(e) => onSelect(e.target.value)}>
      <option value="">—</option>
      {options.map((o) => (
        <option key={o.key} value={o.key}>
          {o.label}
        </option>
      ))}
    </select>
    {children}
  </div>
);

const DefaultFieldWrapper: React.FC<
  NodeProps & { children: React.ReactNode }
> = ({ label, required, name, children, errors }) => (
  <div data-form="field" style={{ marginBottom: "0.75rem" }}>
    {label && (
      <label htmlFor={name} data-form="label">
        {label}
        {required && (
          <span data-form="required" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </label>
    )}
    {children}
    {errors.length > 0 && (
      <ul
        data-form="errors"
        role="alert"
        style={{ color: "red", margin: 0, padding: 0, listStyle: "none" }}
      >
        {errors.map((msg, i) => (
          <li key={i} data-form="error">
            {msg}
          </li>
        ))}
      </ul>
    )}
  </div>
);

const DefaultErrorSummary: React.FC<ErrorSummaryProps> = ({
  errors,
  onSelect
}) => {
  if (errors.length === 0) return null;
  return (
    <div
      data-form="error-summary"
      role="alert"
      style={{ border: "1px solid red", padding: "1rem", marginBottom: "1rem" }}
    >
      <p
        data-form="error-summary-title"
        style={{ margin: 0, fontWeight: "bold" }}
      >
        Please fix the following errors:
      </p>
      <ul style={{ margin: "0.5rem 0 0", padding: "0 0 0 1.5rem" }}>
        {errors.map((err, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => onSelect(err)}
              style={{
                background: "none",
                border: "none",
                color: "red",
                cursor: "pointer",
                padding: 0,
                textDecoration: "underline"
              }}
            >
              {err.label ? `${err.label}: ` : ""}
              {err.message}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

const DefaultErrorList: React.FC<ErrorListProps> = ({ errors }) => (
  <ul
    data-form="error-list"
    role="alert"
    style={{ color: "red", margin: 0, padding: 0, listStyle: "none" }}
  >
    {errors.map((msg, i) => (
      <li key={i} data-form="error-item">
        {msg}
      </li>
    ))}
  </ul>
);

const DefaultForm: React.FC<{
  children: React.ReactNode;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
}> = ({ children, onSubmit }) => (
  <form onSubmit={onSubmit} noValidate>
    {children}
  </form>
);

const DefaultSubmitButton: React.FC<{
  disabled: boolean;
  submitting: boolean;
}> = ({ disabled, submitting }) => (
  <button type="submit" disabled={disabled || submitting} data-form="submit">
    {submitting ? "Submitting…" : "Submit"}
  </button>
);

export const defaultLayoutComponents: LayoutComponents = {
  panel: DefaultPanel,
  arrayPanel: DefaultArrayPanel,
  unionPanel: DefaultUnionPanel,
  fieldWrapper: DefaultFieldWrapper,
  errorSummary: DefaultErrorSummary,
  errorList: DefaultErrorList,
  form: DefaultForm,
  submitButton: DefaultSubmitButton
};

/* -------------------------------------------------------------------------- */
/* Internal rendering                                                          */
/* -------------------------------------------------------------------------- */

function renderNode(
  schema: z.ZodType,
  path: FieldPath,
  key: string | undefined,
  depth: number,
  ctx: InternalCtx
): React.ReactNode {
  const inner = unwrap(schema);
  const name = pathToKey(path);
  const nodeProps: NodeProps = {
    name,
    path,
    label: deriveLabel(schema, key, ctx.opts.label, path),
    description:
      typeof schema.description === "string" ? schema.description : undefined,
    required: isRequired(schema),
    disabled: ctx.disabled,
    depth,
    errors: ctx.errors[name] ?? []
  };

  if (inner instanceof z.ZodObject) {
    const shape = (inner as z.ZodObject<z.ZodRawShape>).shape;
    const children = Object.entries(shape).map(([k, fieldSchema]) =>
      renderNode(asZodType(fieldSchema), [...path, k], k, depth + 1, ctx)
    );
    return (
      <ctx.layout.panel
        key={name || "root"}
        {...nodeProps}
        descendantErrors={getDescendantErrors(ctx.errors, name)}
      >
        {children}
      </ctx.layout.panel>
    );
  }

  if (inner instanceof z.ZodArray) {
    return (
      <ArrayField
        key={name}
        schema={inner as z.ZodArray<z.ZodType>}
        path={path}
        nodeProps={nodeProps}
        depth={depth}
        ctx={ctx}
      />
    );
  }

  return (
    <LeafField
      key={name}
      schema={inner}
      outerSchema={schema}
      path={path}
      nodeProps={nodeProps}
      ctx={ctx}
    />
  );
}

interface ArrayFieldProps {
  schema: z.ZodArray<z.ZodType>;
  path: FieldPath;
  nodeProps: NodeProps;
  depth: number;
  ctx: InternalCtx;
}

function ArrayField({ schema, path, nodeProps, depth, ctx }: ArrayFieldProps) {
  const { min, max } = getArrayConstraints(schema);
  const isControlled = ctx.mode === "controlled";

  const initialArr = getAtPath(ctx.initialValues, path);
  const initialCount = Array.isArray(initialArr) ? initialArr.length : 0;

  // Stable IDs mean removing a middle item doesn't corrupt sibling DOM state
  const [itemIds, setItemIds] = useState<number[]>(() =>
    Array.from({ length: initialCount }, (_, i) => i)
  );
  const nextId = useRef(initialCount);

  const controlledArr = isControlled
    ? (ctx.getValue(path) as unknown[] | undefined)
    : undefined;
  const count = isControlled ? (controlledArr?.length ?? 0) : itemIds.length;

  const onAdd = useCallback(() => {
    const newItem =
      ctx.opts.arrays?.newItem?.([...path, count]) ??
      getSchemaDefault(schema.element);
    if (isControlled) {
      ctx.onChange(path, [...(controlledArr ?? []), newItem]);
    } else {
      const id = nextId.current++;
      setItemIds((ids) => [...ids, id]);
    }
  }, [count, controlledArr, ctx, isControlled, path, schema.element]);

  const onRemove = useCallback(
    (index: number, id: number) => {
      if (isControlled) {
        ctx.onChange(
          path,
          (controlledArr ?? []).filter((_, i) => i !== index)
        );
      } else {
        setItemIds((ids) => ids.filter((x) => x !== id));
      }
    },
    [controlledArr, ctx, isControlled, path]
  );

  const items: ArrayItemProps[] = isControlled
    ? Array.from({ length: count }, (_, i) => ({
        index: i,
        path: [...path, i],
        children: renderNode(
          schema.element,
          [...path, i],
          String(i),
          depth + 1,
          ctx
        ),
        canRemove: count > (min ?? 0),
        onRemove: () => onRemove(i, i)
      }))
    : itemIds.map((id, i) => ({
        index: i,
        path: [...path, i],
        children: renderNode(
          schema.element,
          [...path, i],
          String(i),
          depth + 1,
          ctx
        ),
        canRemove: itemIds.length > (min ?? 0),
        onRemove: () => onRemove(i, id)
      }));

  return (
    <ctx.layout.arrayPanel
      {...nodeProps}
      items={items}
      canAdd={max === undefined || count < max}
      onAdd={onAdd}
      minItems={min}
      maxItems={max}
      descendantErrors={getDescendantErrors(ctx.errors, nodeProps.name)}
    />
  );
}

interface LeafFieldProps {
  schema: z.ZodType; // already unwrapped
  outerSchema: z.ZodType; // original, for defaults
  path: FieldPath;
  nodeProps: NodeProps;
  ctx: InternalCtx;
}

function LeafField({
  schema,
  outerSchema,
  path,
  nodeProps,
  ctx
}: LeafFieldProps) {
  const handleRef = useRef<FieldHandle<unknown>>(null);

  // Register with the form for value collection and scroll-to-error
  useEffect(() => {
    if (handleRef.current) ctx.register(nodeProps.name, handleRef.current);
    return () => ctx.unregister(nodeProps.name);
  }, [ctx, nodeProps.name]);

  const Component = resolveComponent(
    schema,
    nodeProps.name,
    ctx.opts,
    ctx.fields
  );
  const inline = ctx.opts.errors?.inline !== false;

  const sharedProps = { ...nodeProps, schema, ref: handleRef };
  const modeProps =
    ctx.mode === "controlled"
      ? {
          controlled: true as const,
          value: ctx.getValue(path),
          onChange: (v: unknown) => ctx.onChange(path, v),
          onBlur: () => ctx.onBlur(path)
        }
      : {
          controlled: false as const,
          defaultValue: getSchemaDefault(outerSchema)
        };

  return (
    <ctx.layout.fieldWrapper {...nodeProps}>
      <Component {...sharedProps} {...modeProps} />
      {inline && nodeProps.errors.length > 0 && (
        <ctx.layout.errorList name={nodeProps.name} errors={nodeProps.errors} />
      )}
    </ctx.layout.fieldWrapper>
  );
}

/* -------------------------------------------------------------------------- */
/* zodForm                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Walks `schema` and returns a form component. Objects become panels, arrays
 * become panels with add/remove, and leaves are dispatched through the
 * component map.
 *
 * @example
 * const ProfileForm = zodForm(profileSchema, {
 *   mode: "controlled",
 *   errors: { summary: "top" },
 *   scrollToFirstError: true
 * });
 */
export const zodForm = <Schema extends z.ZodType>(
  schema: Schema,
  options: ZodFormOptions<Schema> = {}
): React.FC<ZodFormProps<z.infer<Schema>>> => {
  const fields: FieldComponents = {
    ...defaultFieldComponents,
    ...options.components
  };
  const layout: LayoutComponents = {
    ...defaultLayoutComponents,
    ...options.layout
  };
  const mode = options.mode ?? "uncontrolled";

  return function ZodForm(props) {
    const mergedInitial = props.initialValues ?? options.initialValues;
    const disabled = props.disabled ?? false;

    const [errors, setErrors] = useState<Record<string, readonly string[]>>({});
    const [submitting, setSubmitting] = useState(false);
    const [hasSubmitted, setHasSubmitted] = useState(false);

    // Mutable values store — in controlled mode we also trigger re-renders
    const valuesRef = useRef<unknown>(
      buildInitialValues(schema, mergedInitial)
    );
    const [, forceUpdate] = useState(0);

    // All mounted leaf handles, keyed by dotted path
    const fieldHandles = useRef(new Map<string, FieldHandle<unknown>>());

    const register = useCallback(
      (name: string, handle: FieldHandle<unknown>) => {
        fieldHandles.current.set(name, handle);
      },
      []
    );

    const unregister = useCallback((name: string) => {
      fieldHandles.current.delete(name);
    }, []);

    const gatherValues = useCallback((): unknown => {
      if (mode === "controlled") return valuesRef.current;
      return flatToNested(
        new Map(
          [...fieldHandles.current.entries()].map(([name, h]) => [
            name,
            h.getValue()
          ])
        )
      );
    }, []);

    const getValue = useCallback(
      (path: FieldPath) => getAtPath(valuesRef.current, path),
      []
    );

    const onChange = useCallback(
      (path: FieldPath, value: unknown) => {
        valuesRef.current = setAtPath(valuesRef.current, path, value);
        props.onChange?.(valuesRef.current as DeepPartial<z.infer<Schema>>);
        if (mode === "controlled") forceUpdate((n) => n + 1);
        if (
          hasSubmitted &&
          (options.validation?.revalidateOn ?? ["change"]).includes("change")
        ) {
          const r = schema.safeParse(valuesRef.current);
          setErrors(
            r.success ? {} : buildErrorMap(r.error, options.errors?.format)
          );
        }
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [hasSubmitted, props.onChange]
    );

    const onBlur = useCallback(
      (_path: FieldPath) => {
        if (
          hasSubmitted &&
          (options.validation?.revalidateOn ?? ["change"]).includes("blur")
        ) {
          const r = schema.safeParse(gatherValues());
          setErrors(
            r.success ? {} : buildErrorMap(r.error, options.errors?.format)
          );
        }
      },
      [gatherValues, hasSubmitted]
    );

    const scrollAndFocus = useCallback(
      (errMap: Record<string, readonly string[]>) => {
        const firstKey = Object.keys(errMap)[0];
        if (!firstKey) return;
        const handle = fieldHandles.current.get(firstKey);
        if (!handle) return;
        if (options.scrollToFirstError) {
          handle.element?.scrollIntoView(
            typeof options.scrollToFirstError === "object"
              ? options.scrollToFirstError
              : undefined
          );
        }
        if (options.focusFirstError !== false) handle.focus();
      },
      []
    );

    const handleSubmit = useCallback(
      async (raw: unknown) => {
        const result = schema.safeParse(raw);
        if (result.success) {
          setErrors({});
          setSubmitting(true);
          try {
            await props.onSubmit(result.data);
          } finally {
            setSubmitting(false);
          }
        } else {
          const errMap = buildErrorMap(result.error, options.errors?.format);
          setErrors(errMap);
          setHasSubmitted(true);
          props.onInvalid?.(getDescendantErrors(errMap, ""));
          scrollAndFocus(errMap);
        }
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [props.onSubmit, props.onInvalid, scrollAndFocus]
    );

    const formRef = useRef<HTMLFormElement>(null);

    useImperativeHandle(props.ref, () => ({
      getValues: () => gatherValues() as z.infer<Schema>,
      setValues: (v) => {
        valuesRef.current = v;
        if (mode === "controlled") forceUpdate((n) => n + 1);
      },
      validate: () => schema.safeParse(gatherValues()),
      submit: () => formRef.current?.requestSubmit(),
      reset: (v) => {
        valuesRef.current = buildInitialValues(schema, v ?? mergedInitial);
        setErrors({});
        setHasSubmitted(false);
        if (mode === "controlled") forceUpdate((n) => n + 1);
      },
      setErrors: (errs) => setErrors(errs),
      focusFirstError: () => scrollAndFocus(errors)
    }));

    const summary = options.errors?.summary ?? "none";
    const allErrors = getDescendantErrors(errors, "");

    const ctx: InternalCtx = {
      errors,
      disabled,
      mode,
      opts: options as ZodFormOptions<any>,
      fields,
      layout,
      register,
      unregister,
      getValue,
      onChange,
      onBlur,
      initialValues: buildInitialValues(schema, mergedInitial)
    };

    const tree = renderNode(schema, [], undefined, 0, ctx);

    return (
      <FormCtx.Provider value={ctx}>
        <layout.form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit(gatherValues());
          }}
        >
          {(summary === "top" || summary === "both") && (
            <layout.errorSummary
              errors={allErrors}
              onSelect={(err) => scrollAndFocus({ [err.name]: [err.message] })}
            />
          )}
          {tree}
          {(summary === "bottom" || summary === "both") && (
            <layout.errorSummary
              errors={allErrors}
              onSelect={(err) => scrollAndFocus({ [err.name]: [err.message] })}
            />
          )}
          {props.children ?? (
            <layout.submitButton disabled={disabled} submitting={submitting} />
          )}
        </layout.form>
      </FormCtx.Provider>
    );
  };
};
