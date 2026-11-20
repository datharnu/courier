// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {PqAuth} from "haven-pq-kit/PqAuth.sol";
import {PqTestBase} from "haven-pq-kit-test/PqTestBase.sol";
import {DeliveryReceipts} from "../src/DeliveryReceipts.sol";

contract DeliveryReceiptsTest is PqTestBase {
    DeliveryReceipts internal receipts;
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal attacker = address(0xBAD);

    function setUp() public override {
        super.setUp();
        _register(bob);
        _register(attacker);
        receipts = new DeliveryReceipts();
        vm.warp(1_700_000_000);
    }

    function test_record_verifiesRecipientSignatureAndStoresProof() public {
        bytes32 conv = keccak256("conv-1");
        bytes32 ctHash = keccak256("ciphertext-1");
        bytes memory sig = _sign(bob, receipts.signingMessage(conv, 0, ctHash, bob));

        vm.expectEmit(true, true, true, true);
        emit DeliveryReceipts.Delivered(conv, 0, ctHash, bob, alice);
        vm.prank(alice);
        receipts.record(conv, 0, ctHash, bob, sig);

        (address submitter, uint256 recordedAt) = receipts.receipt(conv, 0, ctHash, bob);
        assertEq(submitter, alice);
        assertEq(recordedAt, block.timestamp);
        assertEq(receipts.count(), 1);
    }

    function test_record_refusesDuplicate() public {
        bytes32 conv = keccak256("conv-1");
        bytes32 ctHash = keccak256("ciphertext-1");
        bytes memory sig = _sign(bob, receipts.signingMessage(conv, 0, ctHash, bob));

        vm.prank(alice);
        receipts.record(conv, 0, ctHash, bob, sig);

        bytes32 id = receipts.receiptKey(conv, 0, ctHash, bob);
        vm.expectRevert(abi.encodeWithSelector(DeliveryReceipts.AlreadyRecorded.selector, id));
        vm.prank(alice);
        receipts.record(conv, 0, ctHash, bob, sig);
    }

    function test_record_refusesZeroWordsAndZeroRecipient() public {
        bytes memory emptySig = "";
        vm.expectRevert(DeliveryReceipts.ZeroWord.selector);
        receipts.record(bytes32(0), 0, keccak256("c"), bob, emptySig);

        vm.expectRevert(DeliveryReceipts.ZeroWord.selector);
        receipts.record(keccak256("c"), 0, bytes32(0), bob, emptySig);

        vm.expectRevert(DeliveryReceipts.ZeroRecipient.selector);
        receipts.record(keccak256("c"), 0, keccak256("h"), address(0), emptySig);
    }

    function test_record_refusesWrongSigner() public {
        bytes32 conv = keccak256("conv-1");
        bytes32 ctHash = keccak256("ciphertext-1");
        bytes memory sig = _sign(attacker, receipts.signingMessage(conv, 0, ctHash, bob));

        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        vm.prank(alice);
        receipts.record(conv, 0, ctHash, bob, sig);
    }

    function test_record_refusesTamperedCounter() public {
        bytes32 conv = keccak256("conv-1");
        bytes32 ctHash = keccak256("ciphertext-1");
        bytes memory sig = _sign(bob, receipts.signingMessage(conv, 0, ctHash, bob));

        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        vm.prank(alice);
        receipts.record(conv, 1, ctHash, bob, sig);
    }

    function testFuzz_record_anyValidMessage(bytes32 conv, uint32 counter, bytes32 ctHash) public {
        vm.assume(conv != bytes32(0) && ctHash != bytes32(0));
        bytes memory sig = _sign(bob, receipts.signingMessage(conv, counter, ctHash, bob));
        vm.prank(alice);
        receipts.record(conv, counter, ctHash, bob, sig);
        (address submitter, uint256 recordedAt) = receipts.receipt(conv, counter, ctHash, bob);
        assertEq(submitter, alice);
        assertEq(recordedAt, block.timestamp);
    }
}
