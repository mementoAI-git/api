import { model, Schema } from "mongoose"

export interface IBeneficiary {
  name: string
  email: string
  relationship: string
  level: number
  user: string
}

const beneficiary = new Schema<IBeneficiary>({
  name: String,
  email: String,
  user: {
    type: String,
    ref: "user"
  },
  relationship: String,
  level: {
    type: Number,
    default: 1
  }
})

const Beneficiary = model("beneficiary", beneficiary)
export default Beneficiary