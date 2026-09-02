/**
 * User management controllers (admin surface).
 */
import * as userService from './user.service.js';
import {
  buildPaginationMeta,
  sendCreated,
  sendNoContent,
  sendSuccess,
} from '../../utils/apiResponse.js';

export const createUser = async (req, res) => {
  const user = await userService.createUser(req.body, req.user.id);
  return sendCreated(res, { user });
};

export const listUsers = async (req, res) => {
  const { page, limit } = req.query;
  const { items, total } = await userService.listUsers(req.query);

  return sendSuccess(res, { users: items }, { meta: buildPaginationMeta({ page, limit, total }) });
};

export const getUser = async (req, res) => {
  const user = await userService.getUserById(req.params.id);
  return sendSuccess(res, { user });
};

export const updateUser = async (req, res) => {
  const user = await userService.updateUser(req.params.id, req.body, req.user.id);
  return sendSuccess(res, { user });
};

export const updateStatus = async (req, res) => {
  const user = await userService.setUserStatus(req.params.id, req.body.isActive, req.user.id);
  return sendSuccess(res, { user });
};

export const resetPassword = async (req, res) => {
  await userService.resetPassword(req.params.id, req.body.newPassword);
  return sendSuccess(res, { message: 'Password reset. The user has been logged out of all devices.' });
};

export const deleteUser = async (req, res) => {
  await userService.deleteUser(req.params.id, req.user.id);
  return sendNoContent(res);
};
