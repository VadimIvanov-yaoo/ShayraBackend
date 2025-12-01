import { Router } from 'express'
import authMiddleware from '../middleware/authMiddleware.js'
import userController from '../controllers/userController.js'
import chatController from '../controllers/chatController.js'

const router = Router()

router.post('/newChat', authMiddleware, chatController.createChat)
router.get('/getMessage', authMiddleware, chatController.getMessage)
router.post('/uploadImage', authMiddleware, chatController.uploadImage)
router.get('/getChats', authMiddleware, chatController.getChats)
router.get('/partner', authMiddleware, chatController.getPartnerInfo)
router.post(
  '/lastedMessage',
  authMiddleware,
  chatController.getLastedChatMessage
)
router.delete('/deleteMessage', authMiddleware, chatController.deleteMessage)
router.delete('/unBlockChat', authMiddleware, chatController.unBlockedChat)
router.put('/readMessage', authMiddleware, chatController.readMessageStatus)
router.get('/getReaction', authMiddleware, chatController.getMessageReaction)
router.delete('/deleteChat', authMiddleware, chatController.deleteChat)
router.post('/blockedChat', authMiddleware, chatController.blockedChat)
router.post('/checkBlocked', authMiddleware, chatController.checkBlockedChat)

export default router
