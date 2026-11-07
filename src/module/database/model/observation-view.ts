import {model, Schema} from 'mongoose';
import type {EnrichmentCategory} from '../../../services/enrichment';
import type {PendingInsightField} from './pending-insight';

/** An observation as shown to the member, written for them. */
export interface IObservationViewItem {
  _id?: string;
  field: PendingInsightField;
  heading: string;
  note: string;
  category: EnrichmentCategory;
  /** The stored facts behind this card. Several can merge into one. */
  sources: string[];
  /** The member's own wording, which curation must not replace. */
  edited: boolean;
}

/**
 * The stored facts stay as they are for the AI to use. This is the curated
 * subset a member sees, so a fact can be useful in chat without becoming a card.
 */
export interface IObservationView {
  _id?: string;
  user: string;
  items: IObservationViewItem[];
  /** Facts already considered, whether or not they became a card. */
  processed: string[];
  generating_until?: Date | null;
  next_attempt_at?: Date | null;
}

const observationViewItemSchema = new Schema<IObservationViewItem>({
  field: {type: String, required: true},
  heading: {type: String, required: true},
  note: {type: String, required: true},
  category: {type: String, required: true},
  sources: {type: [String], default: []},
  edited: {type: Boolean, default: false},
});

const observationViewSchema = new Schema<IObservationView>(
  {
    user: {type: String, ref: 'user', required: true, unique: true},
    items: {type: [observationViewItemSchema], default: []},
    processed: {type: [String], default: []},
    generating_until: {type: Date, default: null},
    next_attempt_at: {type: Date, default: null},
  },
  {timestamps: {createdAt: 'created_at', updatedAt: 'updated_at'}},
);

const ObservationView = model<IObservationView>(
  'observation_view',
  observationViewSchema,
);
export default ObservationView;
