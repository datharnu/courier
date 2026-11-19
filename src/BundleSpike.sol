// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @notice Spike only. Measures the gas of storing one ML-DSA-signed bundle hash.
interface IQorePQC {
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        view
        returns (bool valid);

    function pqcKeyStatus(address account)
        external
        view
        returns (bool registered, uint8 algorithmId, bytes memory pubkey, bool possessionProven);
}

contract BundleSpike {
    address internal constant PQC_VERIFY = 0x0000000000000000000000000000000000000a01;
    address internal constant PQC_STATUS = 0x0000000000000000000000000000000000000a02;

    bytes32 public bundleHash;
    uint256 public expiry;

    error KeyNotRegistered(address account);
    error SignatureInvalid();

    /// @dev Message is abi.encode(chainid, this, sender, bundleHash, expiry).
    function publish(bytes32 bundleHash_, uint256 expiry_, bytes calldata signature) external {
        (bool registered, , bytes memory pubkey, ) = IQorePQC(PQC_STATUS).pqcKeyStatus(msg.sender);
        if (!registered) revert KeyNotRegistered(msg.sender);

        bytes memory message = abi.encode(block.chainid, address(this), msg.sender, bundleHash_, expiry_);
        (bool ok, bytes memory ret) = PQC_VERIFY.staticcall(
            abi.encodeCall(IQorePQC.pqcVerify, (pubkey, signature, message))
        );
        if (!ok || ret.length < 32 || !abi.decode(ret, (bool))) revert SignatureInvalid();

        bundleHash = bundleHash_;
        expiry = expiry_;
    }
}
