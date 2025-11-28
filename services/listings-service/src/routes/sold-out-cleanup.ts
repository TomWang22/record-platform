import { Router } from 'express';

const router: Router = Router();

// This endpoint is not currently used - shopping service handles cart cleanup internally
// POST /listings/:id/mark-sold
router.post('/:id/mark-sold', async (req, res) => {
  // TODO: Implement cart cleanup if needed, or remove this route
  res.status(501).json({ error: 'Not implemented - shopping service handles cart cleanup' });
});

export default router;

