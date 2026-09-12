/** @owner Will */
export interface SurveyAnswers {
  onTime: boolean;
  asDescribed: boolean;
  wouldRepeat: boolean;
}

export interface Review {
  taskId: string;
  raterUuid: string;
  ratedUuid: string;
  rating: number; // 1–5
  surveyAnswers: SurveyAnswers;
  comment?: string;
  ethicsFlag: string | null;
  createdAt: string;
}
