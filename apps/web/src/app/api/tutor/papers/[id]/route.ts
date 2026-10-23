import { nextDeps } from "@/lib/account/next";
import { requireRoleForApi } from "@/lib/auth/guard";
import { assistantRuntime } from "@/lib/assistant/runtime";
import { getDataProvider } from "@/lib/data/provider";
import { handleTutorPaper } from "@/lib/paper/tutorReview";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const { rt } = await nextDeps();
  return handleTutorPaper(
    request,
    {
      rt,
      assistant: assistantRuntime(),
      tutor: async () => {
        const user = await requireRoleForApi(["TUTOR"]);
        return user?.profileId ? { profileId: user.profileId } : null;
      },
      studentsOf: async (tutorId) => (await getDataProvider().assignments.forTutor(tutorId)).filter((a) => a.status === "ACTIVE").flatMap((a) => a.studentIds),
    },
    (await params).id,
  );
}
