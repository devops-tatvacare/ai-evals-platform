import { ReviewBorderGlow } from './ReviewBorderGlow';
import { ReviewPersistentBar } from './ReviewPersistentBar';
import { ReviewNavigationBlocker } from './ReviewNavigationBlocker';

export function ReviewUniverse() {
  return (
    <>
      <ReviewBorderGlow />
      <ReviewPersistentBar />
      <ReviewNavigationBlocker />
    </>
  );
}
