/** @owner Divya */
export interface Candidate {
  uuid: string;
  matchScore: number;
  reasons: string[];
  vectorScore?: number;
  ratingScore?: number;
  experienceScore?: number;
  firstName?: string;
  preferenceText?: string;
  stats?: {
    avgRating: number | null;
    tasksCompleted: number;
  };
}
