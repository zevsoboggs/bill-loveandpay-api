// Yesim Partner API (eSIM). Auth via `token` query param on every request.
import axios from 'axios';
import config from '../config.js';

function client() {
  return axios.create({ baseURL: config.esim.baseUrl, timeout: 30000 });
}
const withToken = (params = {}) => ({ ...params, token: config.esim.token });

async function get(path, params) {
  const { data } = await client().get(path, { params: withToken(params) });
  return data;
}
async function post(path, params, body) {
  const { data } = await client().post(path, body ?? {}, { params: withToken(params) });
  return data;
}

// ── Catalog / read-only ──────────────────────────────────────────────────────
export const getBalance = () => get('/balance');
export const getPlans = () => get('/plans');
export const getSupportedDevices = () => get('/supported_devices');
export const getAllowedOperators = () => get('/allowed_operators');
export const getOrders = (search = '') => get('/orders', { search });
export const getUser = (userId) => get('/user', { user_id: userId });
export const simInfo = (iccid) => get('/sim_info', { iccid });
export const bulkSimInfo = (iccids) => post('/bulk_sim_info', {}, { iccids });

// ── Provisioning (monetized) ─────────────────────────────────────────────────
// Issue one or more eSIMs on a plan (not tied to a Yesim user account).
export const issueEsim = (planId, count = 1) => post('/issue_esim', { plan_id: planId, count });
// Create a Yesim end-user (optional flow).
export const newUser = (email) => post('/new_user', { email });
// Issue an eSIM for an existing Yesim user.
export const newEsim = (userId, planId) => get('/new_esim', { user_id: userId, plan_id: planId });
// Top up an existing eSIM (iccid) with another plan.
export const addPlanIccid = (iccid, planId, paymentId) => post('/add_plan_iccid', { iccid, plan_id: planId, payment_id: paymentId });
// Lifecycle
export const cancelPlan = (iccid) => post('/cancel_plan', { iccid });
export const changeEsim = (iccid) => post('/change_esim', { iccid });
export const setNotificationUrl = (url) => post('/set_notification_url', { url });

export default {
  getBalance, getPlans, getSupportedDevices, getAllowedOperators, getOrders, getUser,
  simInfo, bulkSimInfo, issueEsim, newUser, newEsim, addPlanIccid, cancelPlan, changeEsim, setNotificationUrl,
};
