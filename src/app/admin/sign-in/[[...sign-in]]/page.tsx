import { SignIn } from '@clerk/nextjs';

export const dynamic = 'force-dynamic';

export default function AdminSignInPage() {
  return (
    <div className="flex justify-center py-10">
      <SignIn />
    </div>
  );
}
