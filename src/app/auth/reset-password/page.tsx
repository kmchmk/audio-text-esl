import { resetPassword } from "../actions";
import { A, AuthForm } from "../auth-form";

export default async function ResetPassword({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return (
    <AuthForm
      title="Choose a new password"
      action={resetPassword}
      fields={[
        { name: "token", label: "", hidden: token },
        { name: "password", label: "New password (8+ characters)", type: "password", autoComplete: "new-password" },
      ]}
      submit="Save new password"
      footer={
        <p>
          <A href="/auth/forgot-password">Request a new link</A>
        </p>
      }
    />
  );
}
