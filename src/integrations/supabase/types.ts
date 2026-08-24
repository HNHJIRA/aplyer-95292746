export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      generated_answers: {
        Row: {
          answer_text: string | null
          cache_key: string
          created_at: string
          error: string | null
          fact_ids_used: string[]
          framework: string
          generated_at: string | null
          generation_id: string | null
          generation_started_at: string | null
          id: string
          inventory_source_hash: string | null
          job_context_hash: string | null
          logical_scan_count: number
          mode: string
          model_a: string | null
          model_j: string | null
          prompt_a_version: string | null
          prompt_i_version: string | null
          prompt_j_version: string | null
          provider_call_count: number
          quality_blocking: string[]
          quality_passed: boolean
          question_hash: string
          question_text: string
          resume_id: string | null
          revision_count: number
          status: string
          updated_at: string
          user_id: string
          variants: Json | null
          voice_card_source_hash: string | null
          word_count: number | null
          writedna_version: string | null
        }
        Insert: {
          answer_text?: string | null
          cache_key: string
          created_at?: string
          error?: string | null
          fact_ids_used?: string[]
          framework: string
          generated_at?: string | null
          generation_id?: string | null
          generation_started_at?: string | null
          id?: string
          inventory_source_hash?: string | null
          job_context_hash?: string | null
          logical_scan_count?: number
          mode?: string
          model_a?: string | null
          model_j?: string | null
          prompt_a_version?: string | null
          prompt_i_version?: string | null
          prompt_j_version?: string | null
          provider_call_count?: number
          quality_blocking?: string[]
          quality_passed?: boolean
          question_hash: string
          question_text: string
          resume_id?: string | null
          revision_count?: number
          status?: string
          updated_at?: string
          user_id: string
          variants?: Json | null
          voice_card_source_hash?: string | null
          word_count?: number | null
          writedna_version?: string | null
        }
        Update: {
          answer_text?: string | null
          cache_key?: string
          created_at?: string
          error?: string | null
          fact_ids_used?: string[]
          framework?: string
          generated_at?: string | null
          generation_id?: string | null
          generation_started_at?: string | null
          id?: string
          inventory_source_hash?: string | null
          job_context_hash?: string | null
          logical_scan_count?: number
          mode?: string
          model_a?: string | null
          model_j?: string | null
          prompt_a_version?: string | null
          prompt_i_version?: string | null
          prompt_j_version?: string | null
          provider_call_count?: number
          quality_blocking?: string[]
          quality_passed?: boolean
          question_hash?: string
          question_text?: string
          resume_id?: string | null
          revision_count?: number
          status?: string
          updated_at?: string
          user_id?: string
          variants?: Json | null
          voice_card_source_hash?: string | null
          word_count?: number | null
          writedna_version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "generated_answers_resume_id_fkey"
            columns: ["resume_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          ab_demo_answer: string | null
          ab_demo_completed: boolean
          ab_demo_completed_at: string | null
          ab_demo_created_at: string | null
          ab_demo_generation_id: string | null
          ab_demo_model: string | null
          celebrated_strong: boolean
          created_at: string
          email: string | null
          extension_onboarding_completed: boolean
          extension_onboarding_completed_at: string | null
          fallback_choice_completed: boolean
          first_name: string | null
          id: string
          last_name: string | null
          linkedin: string | null
          location: string | null
          phone: string | null
          portfolio: string | null
          preferred_variant_answer_id: string | null
          preferred_variant_id: string | null
          preferred_variant_selected_at: string | null
          qualifying_prose_count: number
          resume_only: boolean
          resume_uploaded: boolean
          updated_at: string
          voice_card_data: Json | null
          voice_card_error: string | null
          voice_card_generated_at: string | null
          voice_card_generation_id: string | null
          voice_card_generation_started_at: string | null
          voice_card_model: string | null
          voice_card_prompt_version: string | null
          voice_card_source_hash: string | null
          voice_card_source_resume_id: string | null
          voice_card_source_sample_ids: string[] | null
          voice_card_status: string
          voice_confidence: number
          website: string | null
          writedna_stage: string
          writing_sample_count: number
        }
        Insert: {
          ab_demo_answer?: string | null
          ab_demo_completed?: boolean
          ab_demo_completed_at?: string | null
          ab_demo_created_at?: string | null
          ab_demo_generation_id?: string | null
          ab_demo_model?: string | null
          celebrated_strong?: boolean
          created_at?: string
          email?: string | null
          extension_onboarding_completed?: boolean
          extension_onboarding_completed_at?: string | null
          fallback_choice_completed?: boolean
          first_name?: string | null
          id: string
          last_name?: string | null
          linkedin?: string | null
          location?: string | null
          phone?: string | null
          portfolio?: string | null
          preferred_variant_answer_id?: string | null
          preferred_variant_id?: string | null
          preferred_variant_selected_at?: string | null
          qualifying_prose_count?: number
          resume_only?: boolean
          resume_uploaded?: boolean
          updated_at?: string
          voice_card_data?: Json | null
          voice_card_error?: string | null
          voice_card_generated_at?: string | null
          voice_card_generation_id?: string | null
          voice_card_generation_started_at?: string | null
          voice_card_model?: string | null
          voice_card_prompt_version?: string | null
          voice_card_source_hash?: string | null
          voice_card_source_resume_id?: string | null
          voice_card_source_sample_ids?: string[] | null
          voice_card_status?: string
          voice_confidence?: number
          website?: string | null
          writedna_stage?: string
          writing_sample_count?: number
        }
        Update: {
          ab_demo_answer?: string | null
          ab_demo_completed?: boolean
          ab_demo_completed_at?: string | null
          ab_demo_created_at?: string | null
          ab_demo_generation_id?: string | null
          ab_demo_model?: string | null
          celebrated_strong?: boolean
          created_at?: string
          email?: string | null
          extension_onboarding_completed?: boolean
          extension_onboarding_completed_at?: string | null
          fallback_choice_completed?: boolean
          first_name?: string | null
          id?: string
          last_name?: string | null
          linkedin?: string | null
          location?: string | null
          phone?: string | null
          portfolio?: string | null
          preferred_variant_answer_id?: string | null
          preferred_variant_id?: string | null
          preferred_variant_selected_at?: string | null
          qualifying_prose_count?: number
          resume_only?: boolean
          resume_uploaded?: boolean
          updated_at?: string
          voice_card_data?: Json | null
          voice_card_error?: string | null
          voice_card_generated_at?: string | null
          voice_card_generation_id?: string | null
          voice_card_generation_started_at?: string | null
          voice_card_model?: string | null
          voice_card_prompt_version?: string | null
          voice_card_source_hash?: string | null
          voice_card_source_resume_id?: string | null
          voice_card_source_sample_ids?: string[] | null
          voice_card_status?: string
          voice_confidence?: number
          website?: string | null
          writedna_stage?: string
          writing_sample_count?: number
        }
        Relationships: []
      }
      question_classifications: {
        Row: {
          confidence: number
          created_at: string
          framework: string
          model: string | null
          prompt_version: string | null
          question_hash: string
          question_text: string
          reason: string | null
        }
        Insert: {
          confidence?: number
          created_at?: string
          framework: string
          model?: string | null
          prompt_version?: string | null
          question_hash: string
          question_text: string
          reason?: string | null
        }
        Update: {
          confidence?: number
          created_at?: string
          framework?: string
          model?: string | null
          prompt_version?: string | null
          question_hash?: string
          question_text?: string
          reason?: string | null
        }
        Relationships: []
      }
      resume_fact_inventories: {
        Row: {
          created_at: string
          error: string | null
          generated_at: string | null
          generation_id: string | null
          generation_started_at: string | null
          id: string
          inventory_json: Json | null
          model: string | null
          prompt_version: string
          resume_id: string
          schema_version: string
          source_hash: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          generated_at?: string | null
          generation_id?: string | null
          generation_started_at?: string | null
          id?: string
          inventory_json?: Json | null
          model?: string | null
          prompt_version: string
          resume_id: string
          schema_version: string
          source_hash: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          error?: string | null
          generated_at?: string | null
          generation_id?: string | null
          generation_started_at?: string | null
          id?: string
          inventory_json?: Json | null
          model?: string | null
          prompt_version?: string
          resume_id?: string
          schema_version?: string
          source_hash?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resume_fact_inventories_resume_id_fkey"
            columns: ["resume_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
        ]
      }
      resume_scores: {
        Row: {
          completeness: number
          created_at: string
          id: string
          resume_id: string
          score: number
          sections: Json
          strength: number
          strengths: string[]
          suggestions: string[]
          user_id: string
        }
        Insert: {
          completeness: number
          created_at?: string
          id?: string
          resume_id: string
          score: number
          sections?: Json
          strength: number
          strengths?: string[]
          suggestions?: string[]
          user_id: string
        }
        Update: {
          completeness?: number
          created_at?: string
          id?: string
          resume_id?: string
          score?: number
          sections?: Json
          strength?: number
          strengths?: string[]
          suggestions?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resume_scores_resume_id_fkey"
            columns: ["resume_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
        ]
      }
      resumes: {
        Row: {
          file_name: string
          file_size: number
          file_type: string | null
          id: string
          is_current: boolean
          resume_text: string | null
          storage_path: string
          uploaded_at: string
          user_id: string
          version: number
        }
        Insert: {
          file_name: string
          file_size: number
          file_type?: string | null
          id?: string
          is_current?: boolean
          resume_text?: string | null
          storage_path: string
          uploaded_at?: string
          user_id: string
          version?: number
        }
        Update: {
          file_name?: string
          file_size?: number
          file_type?: string | null
          id?: string
          is_current?: boolean
          resume_text?: string | null
          storage_path?: string
          uploaded_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          renews_at: string | null
          tier: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          renews_at?: string | null
          tier?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          renews_at?: string | null
          tier?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          ai_provider: string
          autofill_enabled: boolean
          created_at: string
          notifications: boolean
          telemetry: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_provider?: string
          autofill_enabled?: boolean
          created_at?: string
          notifications?: boolean
          telemetry?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_provider?: string
          autofill_enabled?: boolean
          created_at?: string
          notifications?: boolean
          telemetry?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      waitlist_subscribers: {
        Row: {
          created_at: string
          email: string
          id: string
          source: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          source?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          source?: string | null
        }
        Relationships: []
      }
      welcome_email_events: {
        Row: {
          attempted_at: string
          attempts: number
          created_at: string
          email: string
          error_code: string | null
          first_name: string | null
          id: string
          provider: string
          provider_message_id: string | null
          sent_at: string | null
          source: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempted_at?: string
          attempts?: number
          created_at?: string
          email: string
          error_code?: string | null
          first_name?: string | null
          id?: string
          provider?: string
          provider_message_id?: string | null
          sent_at?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempted_at?: string
          attempts?: number
          created_at?: string
          email?: string
          error_code?: string | null
          first_name?: string | null
          id?: string
          provider?: string
          provider_message_id?: string | null
          sent_at?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      writing_samples: {
        Row: {
          content: string
          content_hash: string | null
          created_at: string
          id: string
          title: string
          type: string
          updated_at: string
          user_id: string
          word_count: number
        }
        Insert: {
          content: string
          content_hash?: string | null
          created_at?: string
          id?: string
          title: string
          type: string
          updated_at?: string
          user_id: string
          word_count?: number
        }
        Update: {
          content?: string
          content_hash?: string | null
          created_at?: string
          id?: string
          title?: string
          type?: string
          updated_at?: string
          user_id?: string
          word_count?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_qualifying_prose: {
        Args: { _content: string; _type: string }
        Returns: boolean
      }
      prose_content_hash: { Args: { _content: string }; Returns: string }
      recalc_writedna: { Args: { _user_id: string }; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
