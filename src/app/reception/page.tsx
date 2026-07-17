import { requirePermission } from "@/lib/auth";
import { getLmsData } from "@/lib/lms-data";
import { ReceptionKiosk } from "./reception-kiosk";

export default async function ReceptionPage() {
  await requirePermission("use_reception");
  return <ReceptionKiosk data={await getLmsData()} />;
}
