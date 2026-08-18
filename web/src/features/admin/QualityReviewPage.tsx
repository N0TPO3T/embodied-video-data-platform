import { ReviewPage } from "../team/ReviewPage";

export function QualityReviewPage({
  navigate,
}: {
  navigate(path: string): void;
}) {
  return <ReviewPage admin navigate={navigate} />;
}
