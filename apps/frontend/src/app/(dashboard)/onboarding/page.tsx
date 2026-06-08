import { redirect } from 'next/navigation';

import { NegocioSetupWizard } from '@/components/onboarding/negocio-setup-wizard';
import { resolveTenantBusinessSetupForUser } from '@/lib/dashboard/tenant-setup';
import { getSessionProfile } from '@/lib/dashboard/session-profile';
import { createServerClient } from '@/lib/supabase/server';

export default async function OnboardingPage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (profile.rol !== 'admin') redirect('/');

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const setup = await resolveTenantBusinessSetupForUser(supabase, user.id);
  if (!setup || setup.complete) redirect('/');

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4">
      <NegocioSetupWizard />
    </div>
  );
}
