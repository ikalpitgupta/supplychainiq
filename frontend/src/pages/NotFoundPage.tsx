import { Link } from "react-router-dom";
import { Button } from "../components/ui";

export default function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
      <p className="text-4xl font-semibold text-ink/25">404</p>
      <p className="text-sm text-ink/70">This page does not exist.</p>
      <Link to="/"><Button variant="secondary" size="sm">Back to Dashboard</Button></Link>
    </div>
  );
}
