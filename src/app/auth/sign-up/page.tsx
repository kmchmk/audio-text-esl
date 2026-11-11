import { signUp } from "../actions";
import { A, AuthForm } from "../auth-form";

export default function SignUp() {
  return (
    <AuthForm
      title="Create your account"
      action={signUp}
      fields={[
        { name: "name", label: "Your name", autoComplete: "name" },
        { name: "email", label: "Email", type: "email", autoComplete: "email" },
        { name: "password", label: "Password (8+ characters)", type: "password", autoComplete: "new-password" },
      ]}
      submit="Create account"
      footer={
        <p>
          Already have an account? <A href="/auth/sign-in">Sign in</A>
        </p>
      }
    />
  );
}
