import { requestReset } from "../actions";
import { A, AuthForm } from "../auth-form";

export default function ForgotPassword() {
  return (
    <AuthForm
      title="Reset your password"
      action={requestReset}
      fields={[{ name: "email", label: "Email", type: "email", autoComplete: "email" }]}
      submit="Send reset link"
      footer={
        <p>
          <A href="/auth/sign-in">Back to sign in</A>
        </p>
      }
    />
  );
}
