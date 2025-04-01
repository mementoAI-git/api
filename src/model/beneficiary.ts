import { model, Schema } from "mongoose"

export interface IBeneficiary {
  email: string
  level: number
  user: string
}

const beneficiary = new Schema<IBeneficiary>({
  email: String,
  user: {
    type: String,
    ref: "user"
  },
  level: {
    type: Number,
    default: 1
  }
})

const Beneficiary = model("beneficiary", beneficiary)
export default Beneficiary