/**
 * Agent State Card
 * Displays agent internal state (FoodAgent specific for now)
 */

import { Activity, Check, X, Clock, Apple, Flame } from 'lucide-react';
import { Card, Badge } from '@/components/ui';
import type { FoodAgentState } from '../utils/traceDataExtractor';

interface AgentStateCardProps {
  agentName: string;
  state: FoodAgentState;
}

export function AgentStateCard({ agentName, state }: AgentStateCardProps) {
  const hasCurrentEntry = state.current_entry && (
    state.current_entry.foods?.length ||
    state.current_entry.food_time ||
    state.current_entry.time_mentioned !== undefined ||
    state.current_entry.quantity_mentioned !== undefined
  );
  
  const hasNutrition = state.nutrition_data && (
    state.nutrition_data.total_calories !== undefined ||
    state.nutrition_data.total_protein !== undefined ||
    state.nutrition_data.total_carbs !== undefined ||
    state.nutrition_data.total_fats !== undefined
  );
  
  const hasSessionFlags = 
    state.food_logged !== undefined ||
    state.can_session_end !== undefined ||
    state.is_meal_confirmed !== undefined;
  
  // If no data to show, don't render
  if (!hasCurrentEntry && !hasNutrition && !hasSessionFlags && !state.conversation_history_length) {
    return null;
  }
  
  return (
    <Card className="bg-[var(--bg-elevated)] border-[var(--border-subtle)]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[var(--text-brand)]" />
          <h4 className="text-[13px] font-semibold text-[var(--text-primary)]">
            {agentName} State
          </h4>
        </div>
      </div>
      
      <div className="px-4 py-3 space-y-4">
        {/* Current Entry */}
        {hasCurrentEntry && (
          <div>
            <h5 className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-2">
              Current Entry
            </h5>
            
            {/* Foods List */}
            {state.current_entry?.foods && state.current_entry.foods.length > 0 && (
              <div className="mb-3">
                <div className="text-[11px] text-[var(--text-muted)] mb-1.5">Foods:</div>
                <div className="space-y-1.5">
                  {state.current_entry.foods.map((food, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-[12px] text-[var(--text-primary)] bg-[var(--bg-tertiary)] px-2 py-1.5 rounded">
                      <Apple className="h-3.5 w-3.5 text-[var(--color-success)]" />
                      <span className="font-medium">{food.name}</span>
                      <span className="text-[var(--text-secondary)]">
                        {food.quantity} {food.unit}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Food Time */}
            {state.current_entry?.food_time && (
              <div className="flex items-center gap-2 text-[12px] mb-2">
                <Clock className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                <span className="text-[var(--text-secondary)]">Time:</span>
                <span className="text-[var(--text-primary)] font-medium">
                  {state.current_entry.food_time}
                </span>
              </div>
            )}
            
            {/* State Flags */}
            <div className="flex items-center gap-2 flex-wrap">
              {state.current_entry?.time_mentioned !== undefined && (
                <Badge variant={state.current_entry.time_mentioned ? 'success' : 'neutral'}>
                  Time {state.current_entry.time_mentioned ? 'mentioned' : 'not mentioned'}
                </Badge>
              )}
              {state.current_entry?.quantity_mentioned !== undefined && (
                <Badge variant={state.current_entry.quantity_mentioned ? 'success' : 'neutral'}>
                  Quantity {state.current_entry.quantity_mentioned ? 'mentioned' : 'not mentioned'}
                </Badge>
              )}
            </div>
          </div>
        )}
        
        {/* Nutrition Summary */}
        {hasNutrition && (
          <div>
            <h5 className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-2">
              Nutrition Summary
            </h5>
            <div className="grid grid-cols-2 gap-2">
              {state.nutrition_data?.total_calories !== undefined && (
                <div className="bg-[var(--bg-tertiary)] px-3 py-2 rounded">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Flame className="h-3.5 w-3.5 text-[var(--color-warning)]" />
                    <span className="text-[11px] text-[var(--text-muted)]">Calories</span>
                  </div>
                  <div className="text-[14px] font-semibold text-[var(--text-primary)]">
                    {state.nutrition_data.total_calories.toFixed(1)}
                  </div>
                </div>
              )}
              {state.nutrition_data?.total_protein !== undefined && (
                <div className="bg-[var(--bg-tertiary)] px-3 py-2 rounded">
                  <div className="text-[11px] text-[var(--text-muted)] mb-1">Protein</div>
                  <div className="text-[14px] font-semibold text-[var(--text-primary)]">
                    {state.nutrition_data.total_protein.toFixed(1)}g
                  </div>
                </div>
              )}
              {state.nutrition_data?.total_carbs !== undefined && (
                <div className="bg-[var(--bg-tertiary)] px-3 py-2 rounded">
                  <div className="text-[11px] text-[var(--text-muted)] mb-1">Carbs</div>
                  <div className="text-[14px] font-semibold text-[var(--text-primary)]">
                    {state.nutrition_data.total_carbs.toFixed(1)}g
                  </div>
                </div>
              )}
              {state.nutrition_data?.total_fats !== undefined && (
                <div className="bg-[var(--bg-tertiary)] px-3 py-2 rounded">
                  <div className="text-[11px] text-[var(--text-muted)] mb-1">Fats</div>
                  <div className="text-[14px] font-semibold text-[var(--text-primary)]">
                    {state.nutrition_data.total_fats.toFixed(1)}g
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        
        {/* Session Flags */}
        {hasSessionFlags && (
          <div>
            <h5 className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-2">
              Session Status
            </h5>
            <div className="flex items-center gap-2 flex-wrap">
              {state.food_logged !== undefined && (
                <div className="flex items-center gap-1.5 text-[12px] bg-[var(--bg-tertiary)] px-2 py-1 rounded">
                  {state.food_logged ? (
                    <Check className="h-3.5 w-3.5 text-[var(--color-success)]" />
                  ) : (
                    <X className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                  )}
                  <span className="text-[var(--text-secondary)]">Food Logged</span>
                </div>
              )}
              {state.is_meal_confirmed !== undefined && (
                <div className="flex items-center gap-1.5 text-[12px] bg-[var(--bg-tertiary)] px-2 py-1 rounded">
                  {state.is_meal_confirmed ? (
                    <Check className="h-3.5 w-3.5 text-[var(--color-success)]" />
                  ) : (
                    <X className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                  )}
                  <span className="text-[var(--text-secondary)]">Meal Confirmed</span>
                </div>
              )}
              {state.can_session_end !== undefined && (
                <div className="flex items-center gap-1.5 text-[12px] bg-[var(--bg-tertiary)] px-2 py-1 rounded">
                  {state.can_session_end ? (
                    <Check className="h-3.5 w-3.5 text-[var(--color-success)]" />
                  ) : (
                    <X className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                  )}
                  <span className="text-[var(--text-secondary)]">Can End Session</span>
                </div>
              )}
            </div>
          </div>
        )}
        
        {/* Conversation History */}
        {state.conversation_history_length !== undefined && (
          <div className="text-[11px] text-[var(--text-muted)] pt-2 border-t border-[var(--border-subtle)]">
            Conversation history: {state.conversation_history_length} turn{state.conversation_history_length !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </Card>
  );
}
