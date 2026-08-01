import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

// Field names match Razorpay Checkout's success callback payload exactly (snake_case) so the
// frontend can forward it as-is — no internal paymentId required, it's resolved server-side
// via the Transaction linked to razorpay_order_id.
export class VerifyBookingPaymentDto {
  @ApiProperty({ description: 'Razorpay payment ID returned by Checkout on success' })
  @IsString()
  @IsNotEmpty()
  razorpay_payment_id: string;

  @ApiProperty({ description: 'Razorpay order ID this payment was made against' })
  @IsString()
  @IsNotEmpty()
  razorpay_order_id: string;

  @ApiProperty({ description: 'Razorpay signature to verify authenticity' })
  @IsString()
  @IsNotEmpty()
  razorpay_signature: string;
}
