import { signIn } from "../actions";
import { A, AuthForm } from "../auth-form";

export default async function SignIn({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const { reset } = await searchParams;
  return (
    <AuthForm
      title="Sign in"
      action={signIn}
      notice={reset ? "Password updated. Sign in with your new password." : undefined}
      fields={[
        { name: "email", label: "Email", type: "email", autoComplete: "email" },
        { name: "password", label: "Password", type: "password", autoComplete: "current-password" },
      ]}
      submit="Sign in"
      footer={
        <>
          <p>
            New here? <A href="/auth/sign-up">Create an account</A>
          </p>
          <p>
            <A href="/auth/forgot-password">Forgot your password?</A>
          </p>
        </>
      }
    />
  );
}
