// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice Pay fUSD and commit to an encrypted memo.
/// @dev The memo is a Courier ciphertext. This contract stores keccak256 of that ciphertext and never
/// the ciphertext, the memo, or the invoice. The call is four words: token, payee, amount, hash.
/// Tokens are pulled from the payer straight to the payee. A token that does not move that exact
/// amount, or that leaves any of it here, is refused. There is no withdraw, because there is no balance.
contract MemoPay {
    struct Payment {
        address payee;
        address token;
        uint256 amount;
        uint256 at;
    }

    /// @dev How many payments have been recorded. A reverted payment does not move it.
    uint256 public count;

    mapping(bytes32 => Payment) private payments;

    event Paid(
        address indexed payer, address indexed payee, bytes32 indexed ciphertextHash, address token, uint256 amount
    );

    error ZeroHash();
    error ZeroAmount();
    error BadAddress();
    error AlreadyPaid(address payer, bytes32 ciphertextHash);
    error TransferFailed();

    /// @notice Move `amount` of `token` from the caller to `payee`, and record `ciphertextHash`.
    /// The same caller cannot record the same hash twice. Another caller can: the record is theirs.
    function pay(address token, address payee, uint256 amount, bytes32 ciphertextHash) external {
        if (ciphertextHash == bytes32(0)) revert ZeroHash();
        if (amount == 0) revert ZeroAmount();
        if (
            payee == address(0) || token == address(0) || payee == msg.sender || payee == token || payee == address(this)
                || token == address(this)
        ) revert BadAddress();
        bytes32 key = keccak256(abi.encode(msg.sender, ciphertextHash));
        if (payments[key].at != 0) revert AlreadyPaid(msg.sender, ciphertextHash);

        // Written before the token call, so a token that calls back cannot record this hash twice.
        // A revert in the transfer undoes the write.
        payments[key] = Payment({payee: payee, token: token, amount: amount, at: block.timestamp});
        count += 1;
        _pull(token, payee, amount);
        emit Paid(msg.sender, payee, ciphertextHash, token, amount);
    }

    /// @notice The payment this payer committed to under this hash. `at` is zero when there is none.
    function payment(address payer, bytes32 ciphertextHash)
        external
        view
        returns (address payee, address token, uint256 amount, uint256 at)
    {
        Payment storage made = payments[keccak256(abi.encode(payer, ciphertextHash))];
        return (made.payee, made.token, made.amount, made.at);
    }

    /// @dev The payee gains `amount`, the payer loses `amount`, and this contract's balance does not change.
    function _pull(address token, address payee, uint256 amount) private {
        uint256 payerBefore = IERC20Minimal(token).balanceOf(msg.sender);
        uint256 payeeBefore = IERC20Minimal(token).balanceOf(payee);
        uint256 heldBefore = IERC20Minimal(token).balanceOf(address(this));
        if (payerBefore < amount) revert TransferFailed();

        (bool ok, bytes memory ret) = token.call(abi.encodeCall(IERC20Minimal.transferFrom, (msg.sender, payee, amount)));
        if (!ok) revert TransferFailed();
        if (ret.length != 0 && (ret.length < 32 || !abi.decode(ret, (bool)))) revert TransferFailed();
        // forge-lint: disable-next-line(incorrect-strict-equality)
        if (IERC20Minimal(token).balanceOf(msg.sender) != payerBefore - amount) revert TransferFailed();
        // forge-lint: disable-next-line(incorrect-strict-equality)
        if (IERC20Minimal(token).balanceOf(payee) != payeeBefore + amount) revert TransferFailed();
        // forge-lint: disable-next-line(incorrect-strict-equality)
        if (IERC20Minimal(token).balanceOf(address(this)) != heldBefore) revert TransferFailed();
    }
}
