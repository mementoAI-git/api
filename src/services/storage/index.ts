import { IKeys, ISavePayload } from "./interface";
import client from "./client"

async function remove(reference: string, keys: IKeys) {
  const { private_key, public_key } = keys
  const { data } = await client.delete(
    `${public_key}/${reference}`,
    { headers: { "x-momento-encryption-key": private_key } }
  )

  return data
}

async function save(payload: ISavePayload, keys: IKeys) {
  const { private_key, public_key } = keys
  const { data } = await client.post(
    `${public_key}`,
    payload,
    { headers: { "x-memento-encryption-key": private_key } }
  )

  return data
}

export default { remove, save }