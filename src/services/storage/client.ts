import Axios from 'axios';
import { STORAGE_API_KEY, STORAGE_BASE_URL } from '../../utils/config';
import { BadRequestException, ServiceError } from '../../utils/service-error';

const storage = Axios.create({
  baseURL: String(STORAGE_BASE_URL),
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    "x-memento-auth-key": String(STORAGE_API_KEY)
  },
});

storage.interceptors.response.use(
  response => response,
  error => {

    if (error.response) {
      const { data, status } = error.response;

      throw new ServiceError(data.message, status, null, error);
    } else if (error.request) {
      return Promise.reject(error.request);
    } else {
      throw new BadRequestException(error.message);
    }
  }
);

export default storage