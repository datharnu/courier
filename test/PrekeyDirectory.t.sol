// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {PqAuth} from "haven-pq-kit/PqAuth.sol";
import {PqTestBase} from "haven-pq-kit-test/PqTestBase.sol";
import {PrekeyDirectory} from "../src/PrekeyDirectory.sol";

contract PrekeyDirectoryTest is PqTestBase {
    PrekeyDirectory internal dir;
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal attacker = address(0xBAD);

    function setUp() public override {
        super.setUp();
        _register(alice);
        dir = new PrekeyDirectory();
    }

    function test_signingMessage_matchesTheSpike() public view {
        bytes32 hash = keccak256("bundle");
        uint256 expiry = block.timestamp + 1 days;
        assertEq(
            dir.signingMessage(alice, hash, expiry),
            abi.encode(block.chainid, address(dir), alice, hash, expiry)
        );
    }

    function test_publish_storesTheHashUntilExpiry() public {
        bytes32 hash = keccak256("bundle");
        uint256 expiry = block.timestamp + 1 days;
        _publish(hash, expiry);
        (bytes32 got, uint256 stored, bool live) = dir.current(alice);
        assertEq(got, hash);
        assertEq(stored, expiry);
        assertTrue(live);

        vm.warp(expiry + 1);
        (got, stored, live) = dir.current(alice);
        assertEq(got, hash);
        assertEq(stored, expiry);
        assertFalse(live);
    }

    function test_current_isEmptyBeforePublish() public view {
        (bytes32 hash, uint256 expiry, bool live) = dir.current(bob);
        assertEq(hash, bytes32(0));
        assertEq(expiry, 0);
        assertFalse(live);
    }

    function test_publish_replacesThePreviousBundle() public {
        _publish(keccak256("first"), block.timestamp + 1 days);
        _publish(keccak256("second"), block.timestamp + 2 days);
        (bytes32 hash,, bool live) = dir.current(alice);
        assertEq(hash, keccak256("second"));
        assertTrue(live);
    }

    function test_publish_refusesAZeroHash() public {
        vm.prank(alice);
        vm.expectRevert(PrekeyDirectory.ZeroHash.selector);
        dir.publish(bytes32(0), block.timestamp + 1 days, "");
    }

    function test_publish_refusesAnExpiredBundle() public {
        uint256 expiry = block.timestamp - 1;
        vm.expectRevert(abi.encodeWithSelector(PrekeyDirectory.Expired.selector, expiry));
        vm.prank(alice);
        dir.publish(keccak256("x"), expiry, "");
    }

    function test_publish_refusesABundlePastSevenDays() public {
        uint256 expiry = block.timestamp + 7 days + 1;
        vm.expectRevert(abi.encodeWithSelector(PrekeyDirectory.ExpiryTooFar.selector, expiry));
        vm.prank(alice);
        dir.publish(keccak256("x"), expiry, "");
    }

    function test_publish_acceptsExactlySevenDays() public {
        _publish(keccak256("week"), block.timestamp + 7 days);
        (,, bool live) = dir.current(alice);
        assertTrue(live);
    }

    function test_publish_refusesAnUnregisteredAccount() public {
        vm.expectRevert(abi.encodeWithSelector(PqAuth.KeyNotRegistered.selector, bob));
        vm.prank(bob);
        dir.publish(keccak256("x"), block.timestamp + 1 days, "");
    }

    function test_publish_refusesAShortSignature() public {
        vm.expectRevert(abi.encodeWithSelector(PqAuth.BadSignatureLength.selector, 65));
        vm.prank(alice);
        dir.publish(keccak256("x"), block.timestamp + 1 days, new bytes(65));
    }

    function test_publish_refusesSomeoneElsesSignature() public {
        _register(attacker);
        bytes32 hash = keccak256("bundle");
        uint256 expiry = block.timestamp + 1 days;
        bytes memory sig = _sign(attacker, dir.signingMessage(alice, hash, expiry));
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        vm.prank(alice);
        dir.publish(hash, expiry, sig);
    }

    function test_publish_refusesASignatureForAnotherDirectory() public {
        PrekeyDirectory other = new PrekeyDirectory();
        bytes32 hash = keccak256("bundle");
        uint256 expiry = block.timestamp + 1 days;
        bytes memory sig = _sign(alice, dir.signingMessage(alice, hash, expiry));
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        vm.prank(alice);
        other.publish(hash, expiry, sig);
    }

    function test_publish_refusesASignatureFromAnotherChain() public {
        bytes32 hash = keccak256("bundle");
        uint256 expiry = block.timestamp + 1 days;
        bytes memory sig = _sig(hash, expiry);
        vm.chainId(block.chainid + 1);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        vm.prank(alice);
        dir.publish(hash, expiry, sig);
    }

    function testFuzz_publish_anyMomentInsideTheWeek(uint256 ahead) public {
        ahead = bound(ahead, 0, 7 days);
        bytes32 hash = keccak256(abi.encode(ahead));
        _publish(hash, block.timestamp + ahead);
        (bytes32 got,, bool live) = dir.current(alice);
        assertEq(got, hash);
        assertTrue(live);
    }

    function _publish(bytes32 hash, uint256 expiry) internal {
        bytes memory sig = _sig(hash, expiry);
        vm.expectEmit(true, true, false, true);
        emit PrekeyDirectory.Published(alice, hash, expiry, sig);
        vm.prank(alice);
        dir.publish(hash, expiry, sig);
    }

    function _sig(bytes32 hash, uint256 expiry) internal view returns (bytes memory) {
        return _sign(alice, dir.signingMessage(alice, hash, expiry));
    }
}
