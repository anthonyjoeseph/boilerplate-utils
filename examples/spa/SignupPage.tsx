import type { PushRouteProps } from "@boilerplate-utils/react";
import {
  zodForm,
  defaultFieldComponents
} from "@boilerplate-utils/template-fns";
import { z } from "zod";
import type { Route } from "./routes";

const signupSchema = z.object({
  name: z.string().min(1).meta({ title: "Full name" }),
  email: z.string().email(),
  birthday: z.date(),
  plan: z.enum(["free", "pro", "enterprise"]),
  newsletter: z.boolean().default(false),
  // objects recurse into a nested panel
  address: z.object({
    street: z.string(),
    city: z.string(),
    postalCode: z.string().regex(/^\d{5}$/)
  }),
  // arrays recurse into a panel with plus/minus buttons
  allergies: z
    .array(
      z.object({ label: z.string(), severity: z.enum(["mild", "severe"]) })
    )
    .max(5)
});

const SignupForm = zodForm(signupSchema, {
  mode: "controlled",
  components: {
    ...defaultFieldComponents,
    // per-type override: render the plan picker as radios instead of a select
    enum: defaultFieldComponents.enum
  },
  // per-path override wins over the type map
  overrides: { "address.postalCode": defaultFieldComponents.string },
  validation: { on: ["blur"], revalidateOn: ["change"] },
  errors: { inline: true, summary: "top" },
  scrollToFirstError: { behavior: "smooth", block: "center" },
  arrays: { reorderable: true },
  initialValues: { plan: "free", allergies: [{ label: "", severity: "mild" }] }
});

export const SignupPage = ({ pushRoute }: PushRouteProps<Route>) => (
  <div>
    <h1>Sign up</h1>
    <SignupForm
      onSubmit={(values) => {
        console.log("submitted", values);
        pushRoute({ path: "home" });
      }}
      onInvalid={(errors) => console.warn(errors)}
    />
  </div>
);
