export {
  getVerdictColor,
  CORRECTNESS_SEVERITY_ORDER as CORRECTNESS_ORDER,
  EFFICIENCY_SEVERITY_ORDER as EFFICIENCY_ORDER,
  INTENT_SEVERITY_ORDER as INTENT_ORDER,
  ADVERSARIAL_CATEGORIES,
} from "@/config/labelDefinitions";

export const CATEGORY_COLORS: Record<string, string> = {
  quantity_ambiguity: "#8b5cf6",
  multi_meal_single_message: "#06b6d4",
  correction_contradiction: "#f97316",
  edit_after_confirmation: "#ec4899",
  future_time_rejection: "#14b8a6",
  contextual_without_context: "#6366f1",
  composite_dish: "#84cc16",
};
